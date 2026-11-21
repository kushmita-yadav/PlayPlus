import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { ApiError } from "../middleware/errors.js";
import { requireAuth, requirePermission } from "../auth/auth.js";

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
  planCode: z.enum(["GOLD", "SILVER", "JUNIOR"]),
  expiresAt: z.string().datetime().optional(),
});

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

membershipRouter.post("/plans", requireAuth, requirePermission("memberships.manage"), async (req, res, next) => {
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
