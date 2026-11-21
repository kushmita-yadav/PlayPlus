import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const notificationRouter = Router();

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

notificationRouter.post("/notifications", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      recipientType: z.enum(["member", "staff", "guest"]),
      recipientId: z.string().trim().max(200).optional(),
      channel: z.enum(["email", "sms", "in_app"]),
      eventType: z.string().trim().min(2).max(100),
      subject: z.string().trim().max(200).optional(),
      body: z.string().trim().min(1).max(5000),
      scheduledAt: z.string().datetime().optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO notification_outbox
         (recipient_type,recipient_id,channel,event_type,subject,body,scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.recipientType, input.recipientId ?? null, input.channel, input.eventType,
       input.subject ?? null, input.body, input.scheduledAt ?? new Date().toISOString()],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

notificationRouter.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["pending", "processing", "sent", "failed", "cancelled"]).optional(),
    }).parse(req.query);
    const result = await db().query(
      `SELECT * FROM notification_outbox
       WHERE ($1::text IS NULL OR status=$1)
       ORDER BY scheduled_at DESC, created_at DESC LIMIT 500`,
      [input.status ?? null],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

notificationRouter.post("/notifications/process", requireAuth, requirePermission("staff.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      provider: z.string().trim().max(100).optional(),
    }).parse(req.body);
    const externalPending = await db().query(
      `SELECT count(*)::int AS count FROM notification_outbox
       WHERE status='pending' AND channel IN ('email','sms') AND scheduled_at<=now()`,
    );
    if (Number(externalPending.rows[0].count) > 0 && !input.provider) {
      throw new ApiError(503,
        "No email/SMS provider is configured. Configure a provider credential before processing delivery.",
        "NOTIFICATION_PROVIDER_NOT_CONFIGURED");
    }
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query(
        `SELECT * FROM notification_outbox
         WHERE status='pending' AND scheduled_at<=now()
         ORDER BY scheduled_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [input.limit],
      );
      const processed: string[] = [];
      for (const notification of pending.rows) {
        if (notification.channel === "in_app") {
          await client.query(
            `UPDATE notification_outbox
             SET status='sent',sent_at=now(),provider='in_app'
             WHERE id=$1`,
            [notification.id],
          );
          processed.push(notification.id);
          continue;
        }
        await client.query(
          `UPDATE notification_outbox
           SET status='processing',attempts=attempts+1,provider=$2
           WHERE id=$1`,
          [notification.id, input.provider],
        );
        // External email/SMS transport intentionally not simulated.
        // Real providers must implement a signed provider callback or webhook.
        await client.query(
          `UPDATE notification_outbox
           SET status='failed',
               last_error='External provider delivery integration is required'
           WHERE id=$1`,
          [notification.id],
        );
        processed.push(notification.id);
      }
      await client.query("COMMIT");
      res.status(202).json({
        success: true,
        data: {
          provider: input.provider,
          processedCount: processed.length,
          providerMessage: "Rows isolated for external delivery; no delivery was falsely reported as successful",
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

notificationRouter.post("/notifications/generate-reminders", requireAuth, requirePermission("staff.manage"), async (_req, res, next) => {
  try {
    const expiry = await db().query(
      `SELECT m.id,m.member_number,m.full_name,m.email,mr.expires_at
       FROM membership_records mr
       JOIN members m ON m.id=mr.member_id
       WHERE mr.status='active' AND mr.expires_at BETWEEN now() AND now()+interval '30 days'
       ORDER BY mr.expires_at`,
    );
    const lowStock = await db().query(
      `SELECT id,name,stock_quantity,low_stock_threshold
       FROM shop_products
       WHERE is_active=true AND stock_quantity<=low_stock_threshold`,
    );
    let created = 0;
    for (const member of expiry.rows) {
      await db().query(
        `INSERT INTO notification_outbox
           (recipient_type,recipient_id,channel,event_type,subject,body)
         SELECT 'member',$1,'email','membership_expiry',
                'Membership renewal reminder',
                $2
         WHERE NOT EXISTS (
           SELECT 1 FROM notification_outbox
           WHERE recipient_type='member' AND recipient_id=$1::text
             AND event_type='membership_expiry'
             AND created_at>now()-interval '7 days'
         )`,
        [member.id,
         `Dear ${member.full_name}, your Champions Club membership expires on ${new Date(member.expires_at).toISOString().slice(0, 10)}.`],
      );
      created++;
    }
    for (const product of lowStock.rows) {
      await db().query(
        `INSERT INTO notification_outbox
           (recipient_type,recipient_id,channel,event_type,subject,body)
         SELECT 'staff',$2,'in_app','low_stock',
                'Low stock alert',
                $1
         WHERE NOT EXISTS (
           SELECT 1 FROM notification_outbox
           WHERE event_type='low_stock'
             AND recipient_id=$2
             AND created_at>now()-interval '24 hours'
         )`,
        [`${product.name} has ${product.stock_quantity} units; threshold is ${product.low_stock_threshold}.`,
         String(product.id)],
      );
      created++;
    }
    res.status(201).json({
      success: true,
      data: { remindersGenerated: created, expiryMembers: expiry.rows.length, lowStockProducts: lowStock.rows.length },
    });
  } catch (error) {
    next(error);
  }
});
