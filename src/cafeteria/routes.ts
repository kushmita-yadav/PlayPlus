import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const cafeteriaRouter = Router();

const menuSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  price: z.coerce.number().min(0),
});

const orderSchema = z.object({
  tabId: z.string().uuid().optional(),
  tableId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  guestName: z.string().trim().min(2).max(120).optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(100),
});

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

cafeteriaRouter.get("/menu", async (_req, res, next) => {
  try {
    const result = await db().query(
      "SELECT id, name, category, price, is_available FROM cafeteria_menu_items WHERE is_available=true ORDER BY category, name",
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.post("/menu", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  try {
    const input = menuSchema.parse(req.body);
    const result = await db().query(
      "INSERT INTO cafeteria_menu_items (name, category, price) VALUES ($1,$2,$3) RETURNING *",
      [input.name, input.category, input.price],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.get("/tables", requireAuth, requirePermission("bar.manage"), async (_req, res, next) => {
  try {
    const result = await db().query("SELECT * FROM cafeteria_tables ORDER BY table_number");
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.post("/tables", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      tableNumber: z.string().trim().min(1).max(20),
      seats: z.coerce.number().int().min(1).max(100).default(4),
    }).parse(req.body);
    const result = await db().query(
      "INSERT INTO cafeteria_tables (table_number, seats) VALUES ($1,$2) RETURNING *",
      [input.tableNumber, input.seats],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.post("/tabs", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      memberId: z.string().uuid().optional(),
      tableId: z.string().uuid().optional(),
      guestName: z.string().trim().min(2).max(120).optional(),
    }).parse(req.body);
    if (!input.memberId && !input.guestName) {
      throw new ApiError(400, "Member or guest name is required", "TAB_OWNER_REQUIRED");
    }
    const result = await db().query(
      `INSERT INTO customer_tabs (member_id, table_id, guest_name)
       VALUES ($1,$2,$3) RETURNING *`,
      [input.memberId ?? null, input.tableId ?? null, input.guestName ?? null],
    );
    if (input.tableId) {
      await db().query("UPDATE cafeteria_tables SET status='occupied' WHERE id=$1", [input.tableId]);
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.post("/orders", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = orderSchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey) {
      const existing = await client.query(
        "SELECT * FROM cafeteria_orders WHERE idempotency_key=$1",
        [idempotencyKey],
      );
      if (existing.rowCount) {
        res.status(200).json({ success: true, data: existing.rows[0], idempotent: true });
        return;
      }
    }
    await client.query("BEGIN");

    if (input.tabId) {
      const tab = await client.query(
        "SELECT id, status FROM customer_tabs WHERE id=$1 FOR UPDATE",
        [input.tabId],
      );
      if (!tab.rowCount) throw new ApiError(404, "Tab not found", "TAB_NOT_FOUND");
      if (tab.rows[0].status !== "open") throw new ApiError(409, "Tab is not open", "TAB_NOT_OPEN");
    }

    let discountPercent = 0;
    if (input.memberId) {
      const membership = await client.query(
        `SELECT mp.benefits
         FROM membership_records mr
         JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE mr.member_id=$1 AND mr.status='active' AND mr.expires_at > now()
         LIMIT 1`,
        [input.memberId],
      );
      if (membership.rowCount) {
        discountPercent = Number(membership.rows[0].benefits.barDiscountPercent ?? 0);
      }
    }

    let subtotal = 0;
    const items: Array<{ id: string; quantity: number; unitPrice: number; lineTotal: number }> = [];
    for (const item of input.items) {
      const menuItem = await client.query(
        "SELECT id, price FROM cafeteria_menu_items WHERE id=$1 AND is_available=true FOR UPDATE",
        [item.menuItemId],
      );
      if (!menuItem.rowCount) throw new ApiError(404, "Menu item unavailable", "MENU_ITEM_NOT_FOUND");
      const unitPrice = Number(menuItem.rows[0].price);
      const lineBeforeDiscount = unitPrice * item.quantity;
      const lineTotal = lineBeforeDiscount * (1 - discountPercent / 100);
      subtotal += lineBeforeDiscount;
      items.push({ id: item.menuItemId, quantity: item.quantity, unitPrice, lineTotal });
    }
    const discountAmount = subtotal * discountPercent / 100;
    const orderNumber = `BAR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(100000 + Math.random() * 900000)}`;
    const order = await client.query(
      `INSERT INTO cafeteria_orders
         (order_number, tab_id, table_id, member_id, guest_name, status,
          subtotal, discount_amount, total_amount, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,'placed',$6,$7,$8,$9,$10)
       RETURNING *`,
      [orderNumber, input.tabId ?? null, input.tableId ?? null, input.memberId ?? null,
       input.guestName ?? null, subtotal, discountAmount, subtotal - discountAmount,
       idempotencyKey ?? null, req.auth?.id ?? null],
    );
    for (const item of items) {
      await client.query(
        "INSERT INTO cafeteria_order_items (order_id, menu_item_id, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)",
        [order.rows[0].id, item.id, item.quantity, item.unitPrice, item.lineTotal],
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

cafeteriaRouter.patch("/orders/:orderId/status", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["placed", "preparing", "ready", "served", "cancelled"]),
    }).parse(req.body);
    const result = await db().query(
      "UPDATE cafeteria_orders SET status=$2, updated_at=now() WHERE id=$1 RETURNING *",
      [req.params.orderId, input.status],
    );
    if (!result.rowCount) throw new ApiError(404, "Order not found", "ORDER_NOT_FOUND");
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.get("/revenue/daily", requireAuth, requirePermission("finance.read"), async (req, res, next) => {
  try {
    const input = z.object({ date: z.string().date().optional() }).parse(req.query);
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    const result = await db().query(
      `SELECT method,
              count(*)::int AS payment_count,
              COALESCE(sum(amount),0)::numeric AS total_amount
       FROM cafeteria_payments
       WHERE status='recorded'
         AND created_at >= $1::date
         AND created_at < ($1::date + interval '1 day')
       GROUP BY method
       ORDER BY method`,
      [date],
    );
    res.status(200).json({
      success: true,
      data: {
        date,
        byMethod: result.rows,
        total: result.rows.reduce((sum, row) => sum + Number(row.total_amount), 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

cafeteriaRouter.post("/tabs/:tabId/settle", requireAuth, requirePermission("bar.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      method: z.enum(["cash", "card", "upi"]),
    }).parse(req.body);
    const idempotencyKey = req.header("idempotency-key");
    await client.query("BEGIN");
    const tab = await client.query(
      "SELECT * FROM customer_tabs WHERE id=$1 AND status='open' FOR UPDATE",
      [req.params.tabId],
    );
    if (!tab.rowCount) throw new ApiError(404, "Open tab not found", "TAB_NOT_FOUND");
    const balance = await client.query(
      `SELECT COALESCE(sum(total_amount),0)::numeric AS balance
       FROM cafeteria_orders
       WHERE tab_id=$1 AND status <> 'cancelled'`,
      [req.params.tabId],
    );
    const amount = Number(balance.rows[0].balance);
    await client.query(
      `INSERT INTO cafeteria_payments (tab_id, amount, method, status, idempotency_key)
       VALUES ($1,$2,$3,'recorded',$4)`,
      [req.params.tabId, amount, input.method,
       idempotencyKey ?? null],
    );
    await client.query(
      "UPDATE customer_tabs SET status='settled', settled_at=now() WHERE id=$1",
      [req.params.tabId],
    );
    if (tab.rows[0].table_id) {
      await client.query("UPDATE cafeteria_tables SET status='available' WHERE id=$1", [tab.rows[0].table_id]);
    }
    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      data: { tabId: req.params.tabId, amount, method: input.method, status: "settled" },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});
