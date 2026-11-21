import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const shopRouter = Router();

const productSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).default(""),
  category: z.string().trim().min(2).max(80),
  price: z.coerce.number().min(0),
  stockQuantity: z.coerce.number().int().min(0).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
});

const orderSchema = z.object({
  memberId: z.string().uuid().optional(),
  channel: z.enum(["counter", "online"]),
  fulfillment: z.enum(["pickup", "delivery"]),
  deliveryAddress: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["cash", "card", "upi", "online"]).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(100),
});

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

shopRouter.get("/products", async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT id, sku, name, description, category, price, stock_quantity,
              low_stock_threshold, is_active
       FROM shop_products
       WHERE is_active=true
       ORDER BY category, name`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/products", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  try {
    const input = productSchema.parse(req.body);
    const result = await db().query(
      `INSERT INTO shop_products
         (sku, name, description, category, price, stock_quantity, low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [input.sku.toUpperCase(), input.name, input.description, input.category,
       input.price, input.stockQuantity, input.lowStockThreshold],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/products/:productId/stock", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      quantityChange: z.coerce.number().int().refine((value) => value !== 0),
      movementType: z.enum(["purchase", "adjustment", "return", "cancellation"]),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body);
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT * FROM shop_products WHERE id=$1 AND is_active=true FOR UPDATE",
      [req.params.productId],
    );
    if (!product.rowCount) throw new ApiError(404, "Product not found", "PRODUCT_NOT_FOUND");
    const nextQuantity = product.rows[0].stock_quantity + input.quantityChange;
    if (nextQuantity < 0) throw new ApiError(409, "Stock adjustment would create negative inventory", "INSUFFICIENT_STOCK");
    const updated = await client.query(
      "UPDATE shop_products SET stock_quantity=$2, updated_at=now() WHERE id=$1 RETURNING *",
      [req.params.productId, nextQuantity],
    );
    await client.query(
      `INSERT INTO stock_movements
         (product_id, movement_type, quantity_change, note, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.productId, input.movementType, input.quantityChange,
       input.note ?? null, req.auth?.id ?? null],
    );
    await client.query("COMMIT");
    res.status(200).json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

shopRouter.get("/low-stock", requireAuth, requirePermission("shop.manage"), async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT id, sku, name, category, stock_quantity, low_stock_threshold
       FROM shop_products
       WHERE is_active=true AND stock_quantity <= low_stock_threshold
       ORDER BY stock_quantity, name`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/orders", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = orderSchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey) {
      const existing = await client.query(
        "SELECT * FROM shop_orders WHERE idempotency_key=$1",
        [idempotencyKey],
      );
      if (existing.rowCount) {
        res.status(200).json({ success: true, data: existing.rows[0], idempotent: true });
        return;
      }
    }

    await client.query("BEGIN");
    let subtotal = 0;
    let discountAmount = 0;
    const items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      discountPercent: number;
      lineTotal: number;
    }> = [];

    let discountPercent = 0;
    if (input.memberId) {
      const membership = await client.query(
        `SELECT mp.benefits
         FROM membership_records mr
         JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE mr.member_id=$1 AND mr.status='active'
           AND mr.expires_at > now()
         LIMIT 1`,
        [input.memberId],
      );
      if (membership.rowCount) {
        discountPercent = Number(membership.rows[0].benefits.shopDiscountPercent ?? 0);
      }
    }

    for (const item of input.items) {
      const product = await client.query(
        "SELECT id, price, stock_quantity FROM shop_products WHERE id=$1 AND is_active=true FOR UPDATE",
        [item.productId],
      );
      if (!product.rowCount) throw new ApiError(404, "Product not found", "PRODUCT_NOT_FOUND");
      if (product.rows[0].stock_quantity < item.quantity) {
        throw new ApiError(409, "Insufficient stock", "INSUFFICIENT_STOCK");
      }
      const unitPrice = Number(product.rows[0].price);
      const lineBeforeDiscount = unitPrice * item.quantity;
      const lineDiscount = lineBeforeDiscount * discountPercent / 100;
      const lineTotal = lineBeforeDiscount - lineDiscount;
      subtotal += lineBeforeDiscount;
      discountAmount += lineDiscount;
      items.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        discountPercent,
        lineTotal,
      });
    }

    const orderNumber = `SHOP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(100000 + Math.random() * 900000)}`;
    const order = await client.query(
      `INSERT INTO shop_orders
         (order_number, member_id, channel, fulfillment, status, idempotency_key,
          subtotal, discount_amount, total_amount, delivery_address)
       VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9)
       RETURNING *`,
      [orderNumber, input.memberId ?? null, input.channel, input.fulfillment,
       idempotencyKey ?? null, subtotal, discountAmount, subtotal - discountAmount,
       input.deliveryAddress ?? null],
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO shop_order_items
           (order_id, product_id, quantity, unit_price, discount_percent, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.rows[0].id, item.productId, item.quantity, item.unitPrice,
         item.discountPercent, item.lineTotal],
      );
      await client.query(
        "UPDATE shop_products SET stock_quantity=stock_quantity-$2, updated_at=now() WHERE id=$1",
        [item.productId, item.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements
           (product_id, movement_type, quantity_change, reference_type, reference_id, created_by)
         VALUES ($1,'sale',$2,'shop_order',$3,$4)`,
        [item.productId, -item.quantity, order.rows[0].id, req.auth?.id ?? null],
      );
    }

    if (input.paymentMethod) {
      await client.query(
        `INSERT INTO shop_payments
           (order_id, amount, method, status, idempotency_key)
         VALUES ($1,$2,$3,'recorded',$4)`,
        [order.rows[0].id, subtotal - discountAmount, input.paymentMethod,
         idempotencyKey ? `${idempotencyKey}:payment` : null],
      );
      await client.query(
        `INSERT INTO receipt_records
           (receipt_number, source_type, source_id, amount, method)
         VALUES ($1,'shop',$2,$3,$4)`,
        [`SHOP-${Date.now()}`, order.rows[0].id, subtotal - discountAmount, input.paymentMethod],
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: order.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

shopRouter.post("/orders/:orderId/fulfill", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      carrier: z.string().trim().min(2).max(100).optional(),
      trackingNumber: z.string().trim().max(100).optional(),
    }).parse(req.body);
    const result = await db().query(
      `UPDATE shop_orders
       SET status='fulfilled', updated_at=now(),
           carrier=COALESCE($2, carrier),
           tracking_number=COALESCE($3, tracking_number),
           delivered_at=CASE WHEN fulfillment='pickup' THEN now() ELSE delivered_at END,
           shipped_at=CASE WHEN fulfillment='delivery' THEN COALESCE(shipped_at, now()) ELSE shipped_at END
       WHERE id=$1 AND status='confirmed'
       RETURNING *`,
      [req.params.orderId, input.carrier ?? null, input.trackingNumber ?? null],
    );
    if (!result.rowCount) {
      throw new ApiError(404, "Confirmed order not found", "ORDER_NOT_FOUND");
    }
    await db().query(
      "INSERT INTO shop_order_status_history (order_id,status,note,created_by) VALUES ($1,'fulfilled',$2,$3)",
      [req.params.orderId, "Order fulfilled", req.auth?.id ?? null],
    );
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

shopRouter.get("/orders", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["pending", "confirmed", "fulfilled", "cancelled"]).optional(),
      channel: z.enum(["counter", "online"]).optional(),
    }).parse(req.query);
    const result = await db().query(
      `SELECT o.*,
              COALESCE(json_agg(json_build_object(
                'productId', oi.product_id, 'quantity', oi.quantity,
                'unitPrice', oi.unit_price, 'lineTotal', oi.line_total
              )) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
       FROM shop_orders o
       LEFT JOIN shop_order_items oi ON oi.order_id=o.id
       WHERE ($1::text IS NULL OR o.status=$1)
         AND ($2::text IS NULL OR o.channel=$2)
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 500`,
      [input.status ?? null, input.channel ?? null],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/products/:productId/variants", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      variantSku: z.string().trim().min(2).max(50),
      name: z.string().trim().min(2).max(120),
      stockQuantity: z.coerce.number().int().min(0).default(0),
      priceOverride: z.coerce.number().min(0).optional(),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO product_variants
         (product_id, variant_sku, name, stock_quantity, price_override, attributes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.productId, input.variantSku.toUpperCase(), input.name,
       input.stockQuantity, input.priceOverride ?? null, JSON.stringify(input.attributes)],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/orders/:orderId/cancel", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    await client.query("BEGIN");
    const order = await client.query(
      "SELECT * FROM shop_orders WHERE id=$1 AND status='confirmed' FOR UPDATE",
      [req.params.orderId],
    );
    if (!order.rowCount) throw new ApiError(404, "Confirmed order not found", "ORDER_NOT_FOUND");
    const items = await client.query(
      "SELECT product_id, quantity FROM shop_order_items WHERE order_id=$1",
      [req.params.orderId],
    );
    for (const item of items.rows) {
      await client.query(
        "UPDATE shop_products SET stock_quantity=stock_quantity+$2, updated_at=now() WHERE id=$1",
        [item.product_id, item.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements
           (product_id, movement_type, quantity_change, reference_type, reference_id, created_by)
         VALUES ($1,'cancellation',$2,'shop_order',$3,$4)`,
        [item.product_id, item.quantity, req.params.orderId, req.auth?.id ?? null],
      );
    }
    await client.query(
      "UPDATE shop_orders SET status='cancelled', updated_at=now() WHERE id=$1",
      [req.params.orderId],
    );
    await client.query("UPDATE shop_payments SET status='refunded' WHERE order_id=$1", [req.params.orderId]);
    await client.query(
      "INSERT INTO shop_order_status_history (order_id,status,note,created_by) VALUES ($1,'cancelled',$2,$3)",
      [req.params.orderId, "Order cancelled and stock restored", req.auth?.id ?? null],
    );
    await client.query("COMMIT");
    res.status(200).json({ success: true, data: { id: req.params.orderId, status: "cancelled" } });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});
