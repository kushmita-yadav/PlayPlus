import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { ApiError } from "../middleware/errors.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { env } from "../config/env.js";
import { createRazorpayOrder, getRazorpayPayment, verifyRazorpaySignature } from "../payments/razorpay.js";

export const membershipRouter = Router();

const planSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  monthlyPrice: z.coerce.number().min(0),
  benefits: z.object({
    courtFreeSessionsPerDay: z.coerce.number().int().min(0).default(0),
    courtDiscountPercent: z.coerce.number().min(0).max(100).default(0),
    shopDiscountPercent: z.coerce.number().min(0).max(100).default(0),
    barDiscountPercent: z.coerce.number().min(0).max(100).default(0),
    maxAge: z.coerce.number().int().positive().optional(),
  }).partial(),
});

const memberSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  email: z.string().email().optional(),
  dateOfBirth: z.string().date().optional(),
  planCode: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  expiresAt: z.string().datetime().optional(),
});

const memberDemoBookingSchema = z.object({
  id: z.string().optional(),
  memberId: z.string().nullable().optional(),
  courtId: z.string(),
  court: z.string().optional(),
  date: z.string().date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().positive().optional(),
  status: z.string(),
  amount: z.coerce.number().optional(),
}).passthrough();

function requireDatabase() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

membershipRouter.get("/plans", async (_req, res, next) => {
  try {
    const db = requireDatabase();
    const result = await db.query(
      `SELECT id, code, name, description, monthly_price, is_active, benefits
       FROM membership_plans WHERE is_active = true ORDER BY monthly_price`,
    );
    res.status(200).json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        monthlyPrice: Number(row.monthly_price),
        benefits: row.benefits,
      })),
    });
  } catch (error) {
    next(error);
  }
});

membershipRouter.get("/mine", requireAuth, async (req, res, next) => {
  try {
    if (req.auth?.role !== "member") {
      throw new ApiError(403, "Member access is required", "MEMBER_ACCESS_REQUIRED");
    }
    const result = await requireDatabase().query(
      `SELECT mr.id, mr.status, mr.approval_status, mr.starts_at, mr.expires_at,
              mp.code AS plan_code, mp.name AS plan_name, mp.monthly_price
       FROM members m
       JOIN membership_records mr ON mr.member_id=m.id
       JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE m.account_id=$1
       ORDER BY mr.created_at DESC LIMIT 1`,
      [req.auth.id],
    );
    res.status(200).json({
      success: true,
      data: {
        membership: result.rows[0] ?? null,
        onlinePaymentAvailable: env.PAYMENT_PROVIDER === "razorpay",
      },
    });
  } catch (error) {
    next(error);
  }
});

membershipRouter.get("/activity", requireAuth, async (req, res, next) => {
  try {
    if (req.auth?.role !== "member") {
      throw new ApiError(403, "Member access is required", "MEMBER_ACCESS_REQUIRED");
    }
    const database = requireDatabase();
    const memberResult = await database.query(
      "SELECT id FROM members WHERE account_id=$1",
      [req.auth.id],
    );
    if (!memberResult.rowCount) throw new ApiError(404, "Member profile not found", "MEMBER_PROFILE_NOT_FOUND");
    const memberId = String(memberResult.rows[0].id);
    const [bookings, orders, payments, sharedState] = await Promise.all([
      database.query(
        `SELECT r.id::text AS id, c.name AS "courtName",
                to_char(r.starts_at AT TIME ZONE $2, 'YYYY-MM-DD') AS date,
                to_char(r.starts_at AT TIME ZONE $2, 'HH24:MI') AS time,
                floor(extract(epoch FROM (r.ends_at-r.starts_at))/60)::int AS "durationMinutes",
                r.status, r.booking_type AS "bookingType", r.final_amount AS amount,
                r.created_at AS "createdAt"
         FROM court_reservations r
         JOIN courts c ON c.id=r.court_id
         WHERE r.member_id=$1
         ORDER BY r.starts_at DESC
         LIMIT 100`,
        [memberId, env.CLUB_TIMEZONE],
      ),
      database.query(
        `SELECT o.id::text AS id, o.order_number AS "orderNumber", o.channel,
                o.fulfillment, o.status, o.subtotal, o.discount_amount AS "discountAmount",
                o.total_amount AS "totalAmount", o.created_at AS "createdAt",
                COALESCE(json_agg(json_build_object(
                  'name', p.name, 'quantity', oi.quantity, 'lineTotal', oi.line_total
                ) ORDER BY p.name) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM shop_orders o
         LEFT JOIN shop_order_items oi ON oi.order_id=o.id
         LEFT JOIN shop_products p ON p.id=oi.product_id
         WHERE o.member_id=$1
         GROUP BY o.id
         ORDER BY o.created_at DESC
         LIMIT 100`,
        [memberId],
      ),
      database.query(
        `SELECT rr.receipt_number AS reference, rr.source_type AS "sourceType",
                COALESCE(so.order_number, c.name, mp.name, initcap(rr.source_type)) AS description,
                rr.amount, COALESCE(rr.method,'manual') AS method,
                'paid'::text AS status, rr.created_at AS "createdAt"
         FROM receipt_records rr
         LEFT JOIN shop_orders so ON rr.source_type='shop' AND so.id=rr.source_id
         LEFT JOIN court_reservations cr ON rr.source_type='court' AND cr.id=rr.source_id
         LEFT JOIN courts c ON c.id=cr.court_id
         LEFT JOIN membership_records mr ON rr.source_type='membership' AND mr.id=rr.source_id
         LEFT JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE ((rr.source_type='shop' AND so.member_id=$1)
             OR (rr.source_type='court' AND cr.member_id=$1)
             OR (rr.source_type='membership' AND mr.member_id=$1))
           AND NOT EXISTS (
             SELECT 1 FROM payment_transactions pt
             WHERE pt.source_id=rr.source_id
               AND ((rr.source_type='shop' AND pt.source_type='shop_order')
                 OR (rr.source_type='membership' AND pt.source_type='membership'))
           )
         UNION ALL
         SELECT COALESCE(pt.gateway_payment_id,pt.gateway_order_id) AS reference,
                CASE pt.source_type WHEN 'shop_order' THEN 'shop' ELSE pt.source_type END AS "sourceType",
                COALESCE(so.order_number,mp.name,'Payment') AS description,
                pt.amount, pt.provider AS method,
                CASE pt.status WHEN 'captured' THEN 'paid' ELSE pt.status END AS status,
                pt.created_at AS "createdAt"
         FROM payment_transactions pt
         LEFT JOIN shop_orders so ON pt.source_type='shop_order' AND so.id=pt.source_id
         LEFT JOIN membership_records mr ON pt.source_type='membership' AND mr.id=pt.source_id
         LEFT JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE (pt.source_type='shop_order' AND so.member_id=$1)
            OR (pt.source_type='membership' AND mr.member_id=$1)
         ORDER BY "createdAt" DESC
         LIMIT 200`,
        [memberId],
      ),
      database.query(
        "SELECT state->'bookings' AS bookings FROM shared_demo_state WHERE singleton_key=1",
      ),
    ]);
    const demoBookings = z.array(memberDemoBookingSchema).default([]).parse(sharedState.rows[0]?.bookings)
      .filter((booking) => booking.memberId === memberId)
      .map((booking, index) => ({
        id: booking.id ?? `shared-${index}`,
        courtName: booking.court ?? "Court",
        date: booking.date,
        time: booking.time,
        durationMinutes: booking.durationMinutes ?? 60,
        status: booking.status,
        bookingType: "individual",
        amount: Number(booking.amount ?? 0),
        createdAt: null,
      }));
    res.status(200).json({
      success: true,
      data: {
        bookings: [...bookings.rows.map((booking) => ({ ...booking, amount: Number(booking.amount) })), ...demoBookings].sort((a, b) =>
          `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).slice(0, 100),
        orders: orders.rows.map((order) => ({
          ...order,
          subtotal: Number(order.subtotal),
          discountAmount: Number(order.discountAmount),
          totalAmount: Number(order.totalAmount),
        })),
        payments: payments.rows.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
      },
    });
  } catch (error) {
    next(error);
  }
});

membershipRouter.get("/members", requireAuth, requirePermission("members.read"), async (_req, res, next) => {
  try {
    const result = await requireDatabase().query(
      `SELECT m.id, m.member_number, m.full_name, m.phone, m.email, m.status AS member_status,
              latest.id AS membership_id, latest.status AS membership_status,
              latest.approval_status,
              latest.expires_at, latest.plan_code, latest.plan_name, latest.monthly_price
       FROM members m
       LEFT JOIN LATERAL (
         SELECT mr.id, mr.status, mr.approval_status, mr.expires_at, mp.code AS plan_code,
                mp.name AS plan_name, mp.monthly_price
         FROM membership_records mr
         JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE mr.member_id=m.id
         ORDER BY CASE mr.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
                  mr.created_at DESC
         LIMIT 1
       ) latest ON true
       ORDER BY m.created_at DESC
       LIMIT 500`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

membershipRouter.get("/members/:memberId/benefits", requireAuth, requirePermission("members.read"), async (req, res, next) => {
  try {
    const db = requireDatabase();
    const result = await db.query(
      `SELECT m.id, m.member_number, m.full_name, m.status AS member_status,
              mp.code AS plan_code, mp.name AS plan_name, mp.benefits,
              mr.status AS membership_status, mr.expires_at
       FROM members m
       LEFT JOIN membership_records mr ON mr.member_id=m.id AND mr.status='active'
       LEFT JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE m.id=$1`,
      [req.params.memberId],
    );
    if (!result.rowCount) throw new ApiError(404, "Member not found", "MEMBER_NOT_FOUND");
    res.status(200).json({
      success: true,
      data: {
        memberId: result.rows[0].id,
        memberNumber: result.rows[0].member_number,
        fullName: result.rows[0].full_name,
        planCode: result.rows[0].plan_code,
        benefits: result.rows[0].benefits ?? {},
        status: result.rows[0].membership_status === "active" &&
          new Date(result.rows[0].expires_at) > new Date() ? "active" : "expired",
        expiresAt: result.rows[0].expires_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

membershipRouter.post("/plans", requireAuth, requirePermission("membership_plans.manage"), async (req, res, next) => {
  try {
    const db = requireDatabase();
    const input = planSchema.parse(req.body);
    const result = await db.query(
      `INSERT INTO membership_plans (code, name, description, monthly_price, benefits)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, code, name, description, monthly_price, is_active, benefits`,
      [input.code.toUpperCase(), input.name, input.description, input.monthlyPrice, input.benefits],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

membershipRouter.post("/members", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = memberSchema.parse(req.body);
    if (input.planCode === "JUNIOR") {
      if (!input.dateOfBirth) throw new ApiError(400, "Junior members require a date of birth", "JUNIOR_DOB_REQUIRED");
      const birth = new Date(`${input.dateOfBirth}T00:00:00Z`);
      const today = new Date();
      let age = today.getUTCFullYear() - birth.getUTCFullYear();
      if (today.getUTCMonth() < birth.getUTCMonth() ||
          (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age--;
      if (age >= 18) throw new ApiError(400, "Junior membership requires an age below 18", "JUNIOR_AGE_INVALID");
    }

    await client.query("BEGIN");
    const plan = await client.query("SELECT id FROM membership_plans WHERE code=$1 AND is_active=true", [input.planCode]);
    if (!plan.rowCount) throw new ApiError(404, "Membership plan not found", "PLAN_NOT_FOUND");

    const memberNumber = `CC-${new Date().getUTCFullYear()}-${cryptoRandomMemberNumber()}`;
    const member = await client.query(
      `INSERT INTO members (member_number, full_name, phone, email, date_of_birth)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, member_number, full_name, phone, email, date_of_birth, status`,
      [memberNumber, input.fullName, input.phone, input.email ?? null, input.dateOfBirth ?? null],
    );
    const memberId = member.rows[0].id;
    const startsAt = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(startsAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    const membership = await client.query(
      `INSERT INTO membership_records (member_id, plan_id, starts_at, expires_at, status)
       VALUES ($1,$2,$3,$4,'active')
       RETURNING id, starts_at, expires_at, status`,
      [memberId, plan.rows[0].id, startsAt, expiresAt],
    );
    await client.query(
      `INSERT INTO membership_history (member_id, membership_record_id, action, to_plan_id)
       VALUES ($1,$2,'registered',$3)`,
      [memberId, membership.rows[0].id, plan.rows[0].id],
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: { ...member.rows[0], planCode: input.planCode, membership: membership.rows[0] },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

membershipRouter.post("/:membershipId/activate", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({ paymentMethod: z.enum(["cash", "card", "upi"]) }).parse(req.body);
    await client.query("BEGIN");
    const pending = await client.query(
      `SELECT mr.id, mr.member_id, mr.approval_status, mp.id AS plan_id, mp.monthly_price
       FROM membership_records mr
       JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE mr.id=$1 AND mr.status='pending'
       FOR UPDATE OF mr`,
      [req.params.membershipId],
    );
    if (!pending.rowCount) throw new ApiError(404, "Pending membership application not found", "PENDING_MEMBERSHIP_NOT_FOUND");
    if (pending.rows[0].approval_status !== "approved") {
      throw new ApiError(409, "Membership application must be approved before payment", "MEMBERSHIP_NOT_APPROVED");
    }
    const checkout = await client.query(
      `SELECT id FROM payment_transactions
       WHERE source_type='membership' AND source_id=$1 AND status='pending'
       LIMIT 1 FOR UPDATE`,
      [req.params.membershipId],
    );
    if (checkout.rowCount) {
      throw new ApiError(409, "An online payment is still pending for this membership", "ONLINE_PAYMENT_PENDING");
    }
    const active = await client.query(
      "SELECT id FROM membership_records WHERE member_id=$1 AND status='active' FOR UPDATE",
      [pending.rows[0].member_id],
    );
    if (active.rowCount) throw new ApiError(409, "Member already has an active membership", "ACTIVE_MEMBERSHIP_EXISTS");

    const activated = await client.query(
      `UPDATE membership_records
       SET status='active', starts_at=now(), expires_at=now()+interval '1 month'
       WHERE id=$1
       RETURNING id, member_id, plan_id, starts_at, expires_at, status`,
      [req.params.membershipId],
    );
    const receiptNumber = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`;
    await client.query(
      `INSERT INTO receipt_records (receipt_number, source_type, source_id, amount, method)
       VALUES ($1,'membership',$2,$3,$4)`,
      [receiptNumber, activated.rows[0].id, pending.rows[0].monthly_price, input.paymentMethod],
    );
    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      data: { ...activated.rows[0], receiptNumber, amount: Number(pending.rows[0].monthly_price) },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

    membershipRouter.post("/:membershipId/checkout", requireAuth, async (req, res, next) => {
      const client = pool ? await pool.connect() : null;
      try {
        if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
        if (req.auth?.role !== "member") {
          throw new ApiError(403, "Member access is required", "MEMBER_ACCESS_REQUIRED");
        }
        if (env.PAYMENT_PROVIDER !== "razorpay") {
          throw new ApiError(503, "Online payments are not configured", "PAYMENT_PROVIDER_UNAVAILABLE");
        }
        await client.query("BEGIN");
        const membership = await client.query(
          `SELECT mr.id, mr.status, mr.approval_status, mp.monthly_price
           FROM membership_records mr
           JOIN members m ON m.id=mr.member_id
           JOIN membership_plans mp ON mp.id=mr.plan_id
           WHERE mr.id=$1 AND m.account_id=$2
           FOR UPDATE OF mr`,
          [req.params.membershipId, req.auth.id],
        );
        if (!membership.rowCount) throw new ApiError(404, "Membership application not found", "MEMBERSHIP_NOT_FOUND");
        if (membership.rows[0].status !== "pending" || membership.rows[0].approval_status !== "approved") {
          throw new ApiError(409, "Only approved applications can be paid", "MEMBERSHIP_NOT_APPROVED");
        }
        const amountPaise = Math.round(Number(membership.rows[0].monthly_price) * 100);
        if (amountPaise <= 0) throw new ApiError(400, "A zero-price membership does not require online payment", "PAYMENT_NOT_REQUIRED");
        const existing = await client.query(
          `SELECT gateway_order_id, amount FROM payment_transactions
           WHERE source_type='membership' AND source_id=$1 AND status='pending'
           ORDER BY created_at DESC LIMIT 1`,
          [req.params.membershipId],
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          res.status(200).json({
            success: true,
            data: {
              provider: "razorpay",
              keyId: env.RAZORPAY_KEY_ID,
              orderId: existing.rows[0].gateway_order_id,
              amountPaise: Math.round(Number(existing.rows[0].amount) * 100),
              currency: "INR",
            },
            idempotent: true,
          });
          return;
        }
        const gatewayOrder = await createRazorpayOrder(amountPaise, `MEM-${String(req.params.membershipId).slice(0, 8).toUpperCase()}`);
        await client.query(
          `INSERT INTO payment_transactions
             (provider, source_type, source_id, gateway_order_id, amount)
           VALUES ('razorpay','membership',$1,$2,$3)`,
          [req.params.membershipId, gatewayOrder.orderId, membership.rows[0].monthly_price],
        );
        await client.query("COMMIT");
        res.status(201).json({
          success: true,
          data: {
            provider: "razorpay",
            keyId: gatewayOrder.keyId,
            orderId: gatewayOrder.orderId,
            amountPaise,
            currency: "INR",
          },
        });
      } catch (error) {
        await client?.query("ROLLBACK");
        next(error);
      } finally {
        client?.release();
      }
    });

    membershipRouter.post("/:membershipId/verify-payment", requireAuth, async (req, res, next) => {
      const client = pool ? await pool.connect() : null;
      try {
        if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
        if (req.auth?.role !== "member") {
          throw new ApiError(403, "Member access is required", "MEMBER_ACCESS_REQUIRED");
        }
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
        const payment = await client.query(
          `SELECT pt.id AS transaction_id, pt.amount, pt.status AS payment_status,
                  pt.gateway_payment_id, mr.id AS membership_id, mr.member_id,
                  mr.plan_id, mr.status AS membership_status, mr.approval_status
           FROM payment_transactions pt
           JOIN membership_records mr ON mr.id=pt.source_id
           JOIN members m ON m.id=mr.member_id
           WHERE pt.provider='razorpay' AND pt.source_type='membership'
             AND pt.gateway_order_id=$1 AND mr.id=$2 AND m.account_id=$3
           FOR UPDATE OF pt, mr`,
          [input.razorpay_order_id, req.params.membershipId, req.auth.id],
        );
        if (!payment.rowCount) throw new ApiError(404, "Membership checkout not found", "PAYMENT_ORDER_NOT_FOUND");
        const transaction = payment.rows[0];
        if (providerPayment.amount !== Math.round(Number(transaction.amount) * 100) ||
            providerPayment.currency !== "INR") {
          throw new ApiError(409, "Payment amount does not match the membership plan", "PAYMENT_AMOUNT_MISMATCH");
        }
        if (transaction.payment_status === "captured") {
          if (transaction.gateway_payment_id !== input.razorpay_payment_id) {
            throw new ApiError(409, "A different payment was already recorded", "PAYMENT_ALREADY_CAPTURED");
          }
          await client.query("COMMIT");
          res.status(200).json({ success: true, data: { membershipId: transaction.membership_id, status: "active" }, idempotent: true });
          return;
        }
        if (transaction.payment_status !== "pending" || transaction.membership_status !== "pending" ||
            transaction.approval_status !== "approved") {
          throw new ApiError(409, "This membership is no longer payable", "PAYMENT_ORDER_CLOSED");
        }
        const active = await client.query(
          "SELECT id FROM membership_records WHERE member_id=$1 AND status='active' FOR UPDATE",
          [transaction.member_id],
        );
        if (active.rowCount) throw new ApiError(409, "Member already has an active membership", "ACTIVE_MEMBERSHIP_EXISTS");
        const activated = await client.query(
          `UPDATE membership_records
           SET status='active', starts_at=now(), expires_at=now()+interval '1 month'
           WHERE id=$1
           RETURNING id, member_id, plan_id, starts_at, expires_at, status`,
          [transaction.membership_id],
        );
        await client.query(
          `UPDATE payment_transactions
           SET gateway_payment_id=$2, status='captured', signature_verified=true, updated_at=now()
           WHERE id=$1`,
          [transaction.transaction_id, input.razorpay_payment_id],
        );
        const receiptNumber = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`;
        await client.query(
          `INSERT INTO receipt_records (receipt_number, source_type, source_id, amount, method)
           VALUES ($1,'membership',$2,$3,'online')`,
          [receiptNumber, transaction.membership_id, transaction.amount],
        );
        await client.query(
          `INSERT INTO membership_history (member_id, membership_record_id, action, to_plan_id, note)
           VALUES ($1,$2,'changed',$3,'Membership activated after Razorpay payment')`,
          [transaction.member_id, transaction.membership_id, transaction.plan_id],
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true, data: { ...activated.rows[0], receiptNumber } });
      } catch (error) {
        await client?.query("ROLLBACK");
        next(error);
      } finally {
        client?.release();
      }
    });

    membershipRouter.post("/:membershipId/approve", requireAuth, requirePermission("members.write"), async (req, res, next) => {
      const client = pool ? await pool.connect() : null;
      try {
        if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE membership_records
           SET approval_status='approved'
           WHERE id=$1 AND status='pending' AND approval_status='pending'
           RETURNING id, member_id, status, approval_status`,
          [req.params.membershipId],
        );
        if (!result.rowCount) {
          throw new ApiError(404, "Pending membership application not found", "PENDING_MEMBERSHIP_NOT_FOUND");
        }
        await client.query(
          `INSERT INTO membership_history (member_id, membership_record_id, action, to_plan_id, note)
           SELECT mr.member_id, mr.id, 'changed', mr.plan_id, 'Membership application approved'
           FROM membership_records mr WHERE mr.id=$1`,
          [req.params.membershipId],
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true, data: result.rows[0] });
      } catch (error) {
        await client?.query("ROLLBACK");
        next(error);
      } finally {
        client?.release();
      }
    });

    membershipRouter.post("/:membershipId/reject", requireAuth, requirePermission("members.write"), async (req, res, next) => {
      const client = pool ? await pool.connect() : null;
      try {
        if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE membership_records
           SET status='cancelled', approval_status='rejected'
           WHERE id=$1 AND status='pending' AND approval_status='pending'
           RETURNING id, member_id, status, approval_status, plan_id`,
          [req.params.membershipId],
        );
        if (!result.rowCount) {
          throw new ApiError(404, "Pending membership application not found", "PENDING_MEMBERSHIP_NOT_FOUND");
        }
        await client.query(
          `INSERT INTO membership_history (member_id, membership_record_id, action, to_plan_id, note)
           VALUES ($1,$2,'cancelled',$3,'Membership application rejected')`,
          [result.rows[0].member_id, result.rows[0].id, result.rows[0].plan_id],
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true, data: result.rows[0] });
      } catch (error) {
        await client?.query("ROLLBACK");
        next(error);
      } finally {
        client?.release();
      }
    });
membershipRouter.post("/members/:memberId/renew", requireAuth, requirePermission("memberships.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      planCode: z.enum(["GOLD", "SILVER", "JUNIOR"]).optional(),
      expiresAt: z.string().datetime().optional(),
    }).parse(req.body);
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT mr.id, mr.plan_id, mr.expires_at, mp.code AS plan_code
       FROM membership_records mr
       JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE mr.member_id=$1 AND mr.status='active'
       ORDER BY mr.created_at DESC LIMIT 1`,
      [req.params.memberId],
    );
    if (!current.rowCount) throw new ApiError(404, "Active membership not found", "MEMBERSHIP_NOT_FOUND");
    const targetCode = input.planCode ?? current.rows[0].plan_code;
    const plan = await client.query("SELECT id FROM membership_plans WHERE code=$1 AND is_active=true", [targetCode]);
    if (!plan.rowCount) throw new ApiError(404, "Membership plan not found", "PLAN_NOT_FOUND");

    const currentExpiry = new Date(current.rows[0].expires_at);
    const base = currentExpiry > new Date() ? currentExpiry : new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(base.getTime() + 365 * 24 * 60 * 60 * 1000);

    await client.query("UPDATE membership_records SET status='cancelled' WHERE id=$1", [current.rows[0].id]);
    const renewed = await client.query(
      `INSERT INTO membership_records (member_id, plan_id, starts_at, expires_at, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id, starts_at, expires_at, status`,
      [req.params.memberId, plan.rows[0].id, new Date(), expiresAt],
    );
    await client.query(
      `INSERT INTO membership_history (member_id, membership_record_id, action, from_plan_id, to_plan_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.memberId, renewed.rows[0].id,
       targetCode === current.rows[0].plan_code ? "renewed" :
         rankPlan(targetCode) > rankPlan(current.rows[0].plan_code) ? "upgraded" : "downgraded",
       current.rows[0].plan_id, plan.rows[0].id],
    );
    await client.query("COMMIT");
    res.status(200).json({ success: true, data: renewed.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

membershipRouter.get("/members/:memberId/history", requireAuth, requirePermission("members.read"), async (req, res, next) => {
  try {
    const db = requireDatabase();
    const result = await db.query(
      `SELECT mh.id, mh.action, mh.note, mh.created_at,
              fp.code AS from_plan_code, tp.code AS to_plan_code
       FROM membership_history mh
       LEFT JOIN membership_plans fp ON fp.id=mh.from_plan_id
       LEFT JOIN membership_plans tp ON tp.id=mh.to_plan_id
       WHERE mh.member_id=$1 ORDER BY mh.created_at DESC`,
      [req.params.memberId],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

membershipRouter.get("/alerts/expiring", requireAuth, requirePermission("members.read"), async (req, res, next) => {
  try {
    const db = requireDatabase();
    const days = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days);
    const result = await db.query(
      `SELECT m.id, m.member_number, m.full_name, mp.code AS plan_code, mr.expires_at
       FROM membership_records mr
       JOIN members m ON m.id=mr.member_id
       JOIN membership_plans mp ON mp.id=mr.plan_id
       WHERE mr.status='active' AND mr.expires_at <= now() + ($1 * interval '1 day')
       ORDER BY mr.expires_at`,
      [days],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

function cryptoRandomMemberNumber(): string {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function rankPlan(code: string): number {
  return code === "GOLD" ? 3 : code === "SILVER" ? 2 : 1;
}
