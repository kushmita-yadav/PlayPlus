import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requireMemberOrPermission, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";
import { enqueueNotification } from "../notifications/outbox.js";

export const courtRouter = Router();
export function validateBookingStart(start: Date): boolean {
  return start.getUTCMinutes() % 30 === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0;
}

const createCourtSchema = z.object({
  sportCode: z.enum(["TENNIS", "PADEL", "BADMINTON", "CRICKET"]),
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(120),
  baseHourlyPrice: z.coerce.number().min(0).default(0),
  bookingIntervalMinutes: z.coerce.number().int().positive().default(30),
  sessionDurationMinutes: z.coerce.number().int().positive().default(60),
});

const reservationSchema = z.object({
  courtId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  participantName: z.string().trim().min(2).max(120).optional(),
  startsAt: z.string().datetime(),
  bookingType: z.enum(["individual", "walk_in", "social"]).default("individual"),
  participants: z.array(z.object({
    memberId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
  })).max(20).default([]),
});

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

courtRouter.get("/", requireAuth, requirePermission("courts.manage"), async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT c.id, c.code, c.name, c.is_active, c.booking_interval_minutes,
              c.session_duration_minutes, c.base_hourly_price, s.code AS sport_code, s.name AS sport_name
       FROM courts c JOIN sports s ON s.id=c.sport_id
       ORDER BY s.name, c.name`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

courtRouter.get("/sports", async (_req, res, next) => {
  try {
    const result = await db().query(
      "SELECT id, code, name, is_active FROM sports WHERE is_active=true ORDER BY name",
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

courtRouter.put("/:courtId/schedule", requireAuth, requirePermission("courts.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      weekday: z.coerce.number().int().min(0).max(6),
      opensAt: z.string().regex(/^\d{2}:\d{2}$/),
      closesAt: z.string().regex(/^\d{2}:\d{2}$/),
      priceOverride: z.coerce.number().min(0).optional(),
      socialPlay: z.boolean().default(false),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO court_schedule_rules
         (court_id, weekday, opens_at, closes_at, price_override, social_play)
       VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (court_id, weekday) DO UPDATE SET
           opens_at=EXCLUDED.opens_at,
           closes_at=EXCLUDED.closes_at,
           price_override=EXCLUDED.price_override,
           social_play=EXCLUDED.social_play
       RETURNING *`,
      [req.params.courtId, input.weekday, input.opensAt, input.closesAt,
       input.priceOverride ?? null, input.socialPlay],
    );
    res.status(result.rowCount ? 201 : 200).json({ success: true, data: result.rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

courtRouter.post("/", requireAuth, requirePermission("courts.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = createCourtSchema.parse(req.body);
    await client.query("BEGIN");
    const sport = await client.query("SELECT id FROM sports WHERE code=$1 AND is_active=true", [input.sportCode]);
    if (!sport.rowCount) throw new ApiError(404, "Sport not found", "SPORT_NOT_FOUND");
    const result = await client.query(
      `INSERT INTO courts (sport_id, code, name, base_hourly_price, booking_interval_minutes, session_duration_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, code, name, base_hourly_price, booking_interval_minutes, session_duration_minutes`,
      [sport.rows[0].id, input.code.toUpperCase(), input.name, input.baseHourlyPrice,
       input.bookingIntervalMinutes, input.sessionDurationMinutes],
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

courtRouter.get("/availability", async (req, res, next) => {
  try {
    const input = z.object({
      courtId: z.string().uuid().optional(),
      date: z.string().date(),
    }).parse(req.query);
    const date = new Date(`${input.date}T00:00:00Z`);
    const from = date;
    const to = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    const result = await db().query(
      `SELECT c.id, c.code, c.name, c.session_duration_minutes,
              c.booking_interval_minutes, c.base_hourly_price,
              COALESCE(json_agg(json_build_object(
                'id', r.id, 'startsAt', r.starts_at, 'endsAt', r.ends_at,
                'status', r.status, 'bookingType', r.booking_type
              ) ORDER BY r.starts_at) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS reservations
       FROM courts c
       LEFT JOIN court_reservations r ON r.court_id=c.id
         AND r.status='confirmed' AND r.starts_at < $2 AND r.ends_at > $1
       WHERE c.is_active=true ${input.courtId ? "AND c.id=$3" : ""}
       GROUP BY c.id
       ORDER BY c.name`,
      input.courtId ? [from, to, input.courtId] : [from, to],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

courtRouter.post("/reservations", requireAuth, requireMemberOrPermission("courts.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = reservationSchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key");

    if (req.auth?.role === "member") {
      if (input.memberId) {
        const ownedMember = await client.query(
          "SELECT id FROM members WHERE id=$1 AND account_id=$2",
          [input.memberId, req.auth.id],
        );
        if (!ownedMember.rowCount) {
          throw new ApiError(403, "Members may only book for their own member profile", "MEMBER_SCOPE_VIOLATION");
        }
      }
    }

    if (idempotencyKey) {
      const existing = await client.query(
        "SELECT * FROM court_reservations WHERE idempotency_key=$1",
        [idempotencyKey],
      );
      if (existing.rowCount) {
        res.status(200).json({ success: true, data: existing.rows[0], idempotent: true });
        return;
      }
    }

    const start = new Date(input.startsAt);
    if (Number.isNaN(start.getTime())) throw new ApiError(400, "Invalid booking start", "INVALID_START");
    if (!validateBookingStart(start)) {
      throw new ApiError(400, "Booking start must use a 30-minute interval", "INVALID_BOOKING_INTERVAL");
    }

    await client.query("BEGIN");
    const court = await client.query(
      `SELECT c.*, s.code AS sport_code
       FROM courts c JOIN sports s ON s.id=c.sport_id
       WHERE c.id=$1 AND c.is_active=true
       FOR UPDATE`,
      [input.courtId],
    );
    if (!court.rowCount) throw new ApiError(404, "Court not found", "COURT_NOT_FOUND");
    const courtRow = court.rows[0];
    const end = new Date(start.getTime() + courtRow.session_duration_minutes * 60 * 1000);

    if (input.memberId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [input.memberId]);
      const dayStart = new Date(start);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const memberBookings = await client.query(
        `SELECT count(*)::int AS count
         FROM court_reservations
         WHERE member_id=$1 AND status='confirmed'
           AND starts_at >= $2 AND starts_at < $3`,
        [input.memberId, dayStart, dayEnd],
      );
      if (memberBookings.rows[0].count >= 2) {
        throw new ApiError(409, "Member has reached the two-session daily limit", "DAILY_LIMIT_REACHED");
      }
    }

    const baseAmount = Number(courtRow.base_hourly_price) * (courtRow.session_duration_minutes / 60);
    let discountAmount = 0;
    if (input.memberId) {
      const membership = await client.query(
        `SELECT mp.benefits
         FROM membership_records mr
         JOIN membership_plans mp ON mp.id=mr.plan_id
         WHERE mr.member_id=$1 AND mr.status='active'
           AND mr.starts_at <= $2 AND mr.expires_at > $2
         LIMIT 1`,
        [input.memberId, start],
      );
      if (membership.rowCount) {
        const benefits = membership.rows[0].benefits as {
          courtFreeSessionsPerDay?: number;
          courtDiscountPercent?: number;
        };
        const freeSessions = benefits.courtFreeSessionsPerDay ?? 0;
        if (freeSessions > 0) {
          const dayStart = new Date(start);
          dayStart.setUTCHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const freeUsed = await client.query(
            `SELECT count(*)::int AS count FROM court_reservations
             WHERE member_id=$1 AND status='confirmed'
               AND starts_at >= $2 AND starts_at < $3`,
            [input.memberId, dayStart, dayEnd],
          );
          if (freeUsed.rows[0].count < freeSessions) {
            discountAmount = baseAmount;
          }
        }
        if (discountAmount === 0) {
          discountAmount = baseAmount * (benefits.courtDiscountPercent ?? 0) / 100;
        }
      }
    }

    const result = await client.query(
      `INSERT INTO court_reservations (
         court_id, member_id, participant_name, starts_at, ends_at, status,
         booking_type, idempotency_key, base_amount, discount_amount, final_amount
       ) VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8,$9,$10)
       RETURNING *`,
      [input.courtId, input.memberId ?? null, input.participantName ?? null,
       start, end, input.bookingType, idempotencyKey ?? null,
       baseAmount, discountAmount, baseAmount - discountAmount],
    );

    const reservationId = result.rows[0].id;
    if (input.bookingType === "social") {
      for (const participant of input.participants) {
        await client.query(
          `INSERT INTO reservation_participants (reservation_id, member_id, participant_name)
           VALUES ($1,$2,$3)`,
          [reservationId, participant.memberId ?? null, participant.name],
        );
      }
    }
    await client.query(
      `INSERT INTO receipt_records
         (receipt_number, source_type, source_id, amount, method)
       VALUES ($1,'court',$2,$3,'online')`,
      [`COURT-${Date.now()}`, reservationId, baseAmount - discountAmount],
    );
    await client.query("COMMIT");
    if (input.memberId) {
      await enqueueNotification({
        recipientType: "member",
        recipientId: input.memberId,
        channel: "email",
        eventType: "booking_confirmed",
        subject: "Court booking confirmed",
        body: `Your court booking is confirmed for ${start.toISOString()}.`,
      });
    }
    if (input.memberId) {
      await enqueueNotification({
        recipientType: "member",
        recipientId: input.memberId,
        channel: "email",
        eventType: "booking_confirmed",
        subject: "Court booking confirmed",
        body: `Your court booking is confirmed for ${start.toISOString()}.`,
      });
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    if (error instanceof Error && error.message.includes("uq_reservations_no_overlap")) {
      next(new ApiError(409, "Court is already reserved for an overlapping time", "COURT_CONFLICT"));
    } else {
      next(error);
    }
  } finally {
    client?.release();
  }
});

courtRouter.post("/reservations/:reservationId/cancel", requireAuth, requirePermission("courts.manage"), async (req, res, next) => {
  try {
    const input = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body);
    const result = await db().query(
      `UPDATE court_reservations
       SET status='cancelled', cancelled_at=now(), cancellation_reason=$2
       WHERE id=$1 AND status='confirmed'
       RETURNING *`,
      [req.params.reservationId, input.reason ?? null],
    );
    if (!result.rowCount) throw new ApiError(404, "Active reservation not found", "RESERVATION_NOT_FOUND");
    if (result.rows[0].member_id) {
      await enqueueNotification({
        recipientType: "member",
        recipientId: result.rows[0].member_id,
        channel: "email",
        eventType: "booking_cancelled",
        subject: "Court booking cancelled",
        body: `Your court booking for ${new Date(result.rows[0].starts_at).toISOString()} was cancelled.`,
      });
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});
