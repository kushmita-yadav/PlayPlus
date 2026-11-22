import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requireMemberOrPermission, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";
import { enqueueNotification } from "../notifications/outbox.js";
import { env } from "../config/env.js";
import { createRazorpayOrder, getRazorpayPayment, verifyRazorpaySignature } from "../payments/razorpay.js";

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

const publicOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email().max(254),
    phone: z.string().trim().min(7).max(20),
  }),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(100).refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    "Each product may only appear once",
  ),
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

shopRouter.get("/checkout-config", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      provider: env.PAYMENT_PROVIDER,
      ...(env.PAYMENT_PROVIDER === "razorpay" ? { keyId: env.RAZORPAY_KEY_ID } : {}),
    },
  });
});

shopRouter.get("/member-discount", requireAuth, requireMemberOrPermission("shop.manage"), async (req, res, next) => {
  try {
    if (req.auth?.role !== "member") {
      throw new ApiError(403, "Member access is required", "MEMBER_ACCESS_REQUIRED");
    }
    const result = await db().query(
      `SELECT mp.benefits
       FROM members m
       JOIN membership_records mr ON mr.member_id=m.id AND mr.status='active' AND mr.expires_at > now()
       JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE m.account_id=$1
       ORDER BY mr.created_at DESC LIMIT 1`,
      [req.auth.id],
    );
    res.status(200).json({
      success: true,
      data: { discountPercent: Number(result.rows[0]?.benefits?.shopDiscountPercent ?? 0) },
    });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/products", requireAuth, requirePermission("shop.catalog"), async (req, res, next) => {
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

shopRouter.post("/orders/public", async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = publicOrderSchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 128)) {
      throw new ApiError(400, "Invalid idempotency key", "INVALID_IDEMPOTENCY_KEY");
    }
    await client.query("BEGIN");
    if (idempotencyKey) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
      const existing = await client.query(
        `SELECT o.id, o.order_number, o.status, o.total_amount, pt.gateway_order_id
         FROM shop_orders o
         LEFT JOIN payment_transactions pt ON pt.source_type='shop_order' AND pt.source_id=o.id
           AND pt.status='pending'
         WHERE o.idempotency_key=$1`,
        [idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        res.status(200).json({
          success: true,
          data: {
            orderNumber: existing.rows[0].order_number,
            status: existing.rows[0].status,
            totalAmount: Number(existing.rows[0].total_amount),
            ...(existing.rows[0].gateway_order_id ? {
              checkout: {
                provider: "razorpay",
                keyId: env.RAZORPAY_KEY_ID,
                orderId: existing.rows[0].gateway_order_id,
                amountPaise: Math.round(Number(existing.rows[0].total_amount) * 100),
                currency: "INR",
              },
            } : {}),
          },
          idempotent: true,
        });
        return;
      }
    }

    let subtotal = 0;
    const items: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number }> = [];
    for (const item of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await client.query(
        "SELECT id, price, stock_quantity FROM shop_products WHERE id=$1 AND is_active=true FOR UPDATE",
        [item.productId],
      );
      if (!product.rowCount) throw new ApiError(404, "Product not found", "PRODUCT_NOT_FOUND");
      if (Number(product.rows[0].stock_quantity) < item.quantity) {
        throw new ApiError(409, "Insufficient stock", "INSUFFICIENT_STOCK");
      }
      const unitPrice = Number(product.rows[0].price);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      items.push({ productId: item.productId, quantity: item.quantity, unitPrice, lineTotal });
    }

    const orderNumber = `SHOP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const order = await client.query(
      `INSERT INTO shop_orders
         (order_number, channel, fulfillment, status, idempotency_key,
          subtotal, discount_amount, total_amount, customer_name, customer_email, customer_phone)
       VALUES ($1,'online','pickup','pending',$2,$3,0,$3,$4,$5,$6)
       RETURNING id, order_number, status, total_amount`,
      [orderNumber, idempotencyKey ?? null, subtotal, input.customer.name, input.customer.email, input.customer.phone],
    );
    for (const item of items) {
      await client.query(
        `INSERT INTO shop_order_items (order_id, product_id, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.rows[0].id, item.productId, item.quantity, item.unitPrice, item.lineTotal],
      );
      await client.query(
        "UPDATE shop_products SET stock_quantity=stock_quantity-$2, updated_at=now() WHERE id=$1",
        [item.productId, item.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements
           (product_id, movement_type, quantity_change, reference_type, reference_id)
         VALUES ($1,'sale',$2,'shop_order',$3)`,
        [item.productId, -item.quantity, order.rows[0].id],
      );
    }
    let checkout: { provider: "razorpay"; keyId: string; orderId: string; amountPaise: number; currency: string } | undefined;
    if (env.PAYMENT_PROVIDER === "razorpay") {
      const amountPaise = Math.round(Number(order.rows[0].total_amount) * 100);
      if (amountPaise <= 0) throw new ApiError(400, "A zero-total order does not require online payment", "PAYMENT_NOT_REQUIRED");
      const gatewayOrder = await createRazorpayOrder(amountPaise, orderNumber);
      await client.query(
        `INSERT INTO payment_transactions
           (provider, source_type, source_id, gateway_order_id, amount)
         VALUES ('razorpay','shop_order',$1,$2,$3)`,
        [order.rows[0].id, gatewayOrder.orderId, order.rows[0].total_amount],
      );
      checkout = { provider: "razorpay", keyId: gatewayOrder.keyId, orderId: gatewayOrder.orderId, amountPaise, currency: "INR" };
    }
    await client.query(
      `INSERT INTO shop_order_status_history (order_id,status,note)
       VALUES ($1,'pending',$2)`,
      [order.rows[0].id, checkout ? "Pickup order submitted; Razorpay payment pending" : "Pickup order submitted; payment due at the club"],
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: {
        orderNumber: order.rows[0].order_number,
        status: order.rows[0].status,
        totalAmount: Number(order.rows[0].total_amount),
        subtotal: Number(order.rows[0].subtotal),
        discountAmount: Number(order.rows[0].discount_amount),
        ...(checkout ? { checkout } : {}),
      },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

shopRouter.post("/orders/public/verify-payment", async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      razorpay_order_id: z.string().min(1).max(128),
      razorpay_payment_id: z.string().min(1).max(128),
      razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
    }).parse(req.body);
    if (!verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
      throw new ApiError(400, "Payment signature is invalid", "PAYMENT_SIGNATURE_INVALID");
    }
    const providerPayment = await getRazorpayPayment(input.razorpay_payment_id);
    if (providerPayment.id !== input.razorpay_payment_id ||
        providerPayment.order_id !== input.razorpay_order_id ||
        providerPayment.status !== "captured") {
      throw new ApiError(409, "Payment is not captured for this checkout", "PAYMENT_NOT_CAPTURED");
    }

    await client.query("BEGIN");
    const result = await client.query(
      `SELECT pt.id AS transaction_id, pt.amount, pt.status AS payment_status,
              pt.gateway_payment_id, o.id AS order_id, o.order_number, o.total_amount, o.status
       FROM payment_transactions pt
       JOIN shop_orders o ON o.id=pt.source_id
       WHERE pt.provider='razorpay' AND pt.source_type='shop_order'
         AND pt.gateway_order_id=$1
       FOR UPDATE OF pt, o`,
      [input.razorpay_order_id],
    );
    if (!result.rowCount) throw new ApiError(404, "Checkout order not found", "PAYMENT_ORDER_NOT_FOUND");
    const transaction = result.rows[0];
    if (providerPayment.amount !== Math.round(Number(transaction.amount) * 100) ||
        providerPayment.currency !== "INR") {
      throw new ApiError(409, "Payment amount does not match the order", "PAYMENT_AMOUNT_MISMATCH");
    }
    if (transaction.payment_status === "captured") {
      if (transaction.gateway_payment_id !== input.razorpay_payment_id) {
        throw new ApiError(409, "A different payment was already recorded", "PAYMENT_ALREADY_CAPTURED");
      }
      await client.query("COMMIT");
      res.status(200).json({
        success: true,
        data: { orderNumber: transaction.order_number, status: transaction.status, totalAmount: Number(transaction.total_amount) },
        idempotent: true,
      });
      return;
    }
    if (transaction.payment_status !== "pending" || transaction.status !== "pending") {
      throw new ApiError(409, "This checkout is no longer payable", "PAYMENT_ORDER_CLOSED");
    }
    const receiptNumber = `SHOP-${randomUUID().slice(0, 8).toUpperCase()}`;
    await client.query(
      `INSERT INTO shop_payments (order_id, amount, method, status, idempotency_key)
       VALUES ($1,$2,'online','recorded',$3)`,
      [transaction.order_id, transaction.total_amount, `razorpay:${input.razorpay_payment_id}`],
    );
    await client.query(
      `INSERT INTO receipt_records (receipt_number, source_type, source_id, amount, method)
       VALUES ($1,'shop',$2,$3,'online')`,
      [receiptNumber, transaction.order_id, transaction.total_amount],
    );
    const confirmed = await client.query(
      `UPDATE shop_orders SET status='confirmed', updated_at=now()
       WHERE id=$1 RETURNING order_number, status, total_amount`,
      [transaction.order_id],
    );
    await client.query(
      `UPDATE payment_transactions
       SET gateway_payment_id=$2, status='captured', signature_verified=true, updated_at=now()
       WHERE id=$1`,
      [transaction.transaction_id, input.razorpay_payment_id],
    );
    await client.query(
      `INSERT INTO shop_order_status_history (order_id,status,note)
       VALUES ($1,'confirmed','Razorpay payment captured')`,
      [transaction.order_id],
    );
    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      data: { ...confirmed.rows[0], totalAmount: Number(confirmed.rows[0].total_amount), receiptNumber },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

shopRouter.post("/orders", requireAuth, requireMemberOrPermission("shop.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = orderSchema.parse(req.body);
    const onlineCheckout = input.paymentMethod === "online";
    const orderPaidAtCreation = Boolean(input.paymentMethod) && !onlineCheckout;
    if (onlineCheckout && env.PAYMENT_PROVIDER !== "razorpay") {
      throw new ApiError(503, "Online payments are not configured", "PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (req.auth?.role === "member" && input.memberId) {
      const ownedMember = await client.query(
        "SELECT id FROM members WHERE id=$1 AND account_id=$2",
        [input.memberId, req.auth.id],
      );
      if (!ownedMember.rowCount) {
        throw new ApiError(403, "Members may only place orders for their own member profile", "MEMBER_SCOPE_VIOLATION");
      }
    }
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT o.*, pt.gateway_order_id
         FROM shop_orders o
         LEFT JOIN payment_transactions pt ON pt.source_type='shop_order' AND pt.source_id=o.id
           AND pt.status='pending'
         WHERE o.idempotency_key=$1`,
        [idempotencyKey],
      );
      if (existing.rowCount) {
        const order = existing.rows[0];
        res.status(200).json({
          success: true,
          data: {
            ...order,
            ...(order.gateway_order_id ? {
              checkout: {
                provider: "razorpay",
                keyId: env.RAZORPAY_KEY_ID,
                orderId: order.gateway_order_id,
                amountPaise: Math.round(Number(order.total_amount) * 100),
                currency: "INR",
              },
            } : {}),
          },
          idempotent: true,
        });
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [orderNumber, input.memberId ?? null, input.channel, input.fulfillment,
       onlineCheckout || !input.paymentMethod ? "pending" : "confirmed",
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

    let checkout: { provider: "razorpay"; keyId: string; orderId: string; amountPaise: number; currency: string } | undefined;
    if (onlineCheckout) {
      const amountPaise = Math.round((subtotal - discountAmount) * 100);
      if (amountPaise <= 0) throw new ApiError(400, "A zero-total order does not require online payment", "PAYMENT_NOT_REQUIRED");
      const gatewayOrder = await createRazorpayOrder(amountPaise, orderNumber);
      await client.query(
        `INSERT INTO payment_transactions
           (provider, source_type, source_id, gateway_order_id, amount)
         VALUES ('razorpay','shop_order',$1,$2,$3)`,
        [order.rows[0].id, gatewayOrder.orderId, subtotal - discountAmount],
      );
      checkout = { provider: "razorpay", keyId: gatewayOrder.keyId, orderId: gatewayOrder.orderId, amountPaise, currency: "INR" };
    } else if (input.paymentMethod) {
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
    if (input.memberId && orderPaidAtCreation) {
      await enqueueNotification({
        recipientType: "member",
        recipientId: input.memberId,
        channel: "email",
        eventType: "payment_receipt",
        subject: "Your shop purchase receipt",
        body: `Your shop order ${order.rows[0].order_number} was confirmed for ${subtotal - discountAmount}.`,
      });
    }
    res.status(201).json({
      success: true,
      data: {
        ...order.rows[0],
        subtotal,
        discountAmount,
        totalAmount: subtotal - discountAmount,
        ...(checkout ? { checkout } : {}),
      },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

shopRouter.post("/orders/:orderId/confirm", requireAuth, requirePermission("shop.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({ paymentMethod: z.enum(["cash", "card", "upi"]) }).parse(req.body);
    await client.query("BEGIN");
    const pending = await client.query(
      "SELECT id, order_number, total_amount FROM shop_orders WHERE id=$1 AND status='pending' FOR UPDATE",
      [req.params.orderId],
    );
    if (!pending.rowCount) throw new ApiError(404, "Pending shop order not found", "ORDER_NOT_FOUND");
    const onlinePayment = await client.query(
      `SELECT id FROM payment_transactions
       WHERE source_type='shop_order' AND source_id=$1 AND status='pending'
       LIMIT 1 FOR UPDATE`,
      [req.params.orderId],
    );
    if (onlinePayment.rowCount) {
      throw new ApiError(409, "This order is awaiting its online payment", "ONLINE_PAYMENT_PENDING");
    }
    await client.query(
      `INSERT INTO shop_payments (order_id, amount, method, status)
       VALUES ($1,$2,$3,'recorded')`,
      [pending.rows[0].id, pending.rows[0].total_amount, input.paymentMethod],
    );
    const receiptNumber = `SHOP-${randomUUID().slice(0, 8).toUpperCase()}`;
    await client.query(
      `INSERT INTO receipt_records (receipt_number, source_type, source_id, amount, method)
       VALUES ($1,'shop',$2,$3,$4)`,
      [receiptNumber, pending.rows[0].id, pending.rows[0].total_amount, input.paymentMethod],
    );
    const confirmed = await client.query(
      `UPDATE shop_orders SET status='confirmed', updated_at=now()
       WHERE id=$1 RETURNING id, order_number, status, total_amount`,
      [pending.rows[0].id],
    );
    await client.query(
      `INSERT INTO shop_order_status_history (order_id,status,note,created_by)
       VALUES ($1,'confirmed',$2,$3)`,
      [pending.rows[0].id, `Payment received at club via ${input.paymentMethod}`, req.auth?.id ?? null],
    );
    await client.query("COMMIT");
    res.status(200).json({ success: true, data: { ...confirmed.rows[0], receiptNumber } });
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
      `SELECT o.*, latest_payment.status AS payment_status,
              COALESCE(json_agg(json_build_object(
                'productId', oi.product_id, 'name', p.name, 'quantity', oi.quantity,
                'unitPrice', oi.unit_price, 'lineTotal', oi.line_total
              )) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
       FROM shop_orders o
       LEFT JOIN shop_order_items oi ON oi.order_id=o.id
       LEFT JOIN shop_products p ON p.id=oi.product_id
       LEFT JOIN LATERAL (
         SELECT pt.status FROM payment_transactions pt
         WHERE pt.source_type='shop_order' AND pt.source_id=o.id
         ORDER BY pt.created_at DESC LIMIT 1
       ) latest_payment ON true
       WHERE ($1::text IS NULL OR o.status=$1)
         AND ($2::text IS NULL OR o.channel=$2)
       GROUP BY o.id, latest_payment.status
       ORDER BY o.created_at DESC
       LIMIT 500`,
      [input.status ?? null, input.channel ?? null],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

shopRouter.post("/products/:productId/variants", requireAuth, requirePermission("shop.catalog"), async (req, res, next) => {
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
      "SELECT * FROM shop_orders WHERE id=$1 AND status IN ('pending','confirmed') FOR UPDATE",
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
