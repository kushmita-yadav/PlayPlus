import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const operationsRouter = Router();

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

operationsRouter.post("/public/enquiries", async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(7).max(20),
      email: z.string().email().optional(),
      interest: z.string().trim().min(2).max(300),
      source: z.string().trim().max(50).default("website"),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO enquiries (name, phone, email, interest, source)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.name, input.phone, input.email ?? null, input.interest, input.source],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/enquiries", requireAuth, requirePermission("members.read"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const result = await db().query(
      `SELECT * FROM enquiries
       WHERE ($1::text IS NULL OR status=$1)
       ORDER BY created_at DESC`,
      [status ?? null],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch("/enquiries/:enquiryId", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["new", "follow_up", "quoted", "converted", "closed"]),
    }).parse(req.body);
    const result = await db().query(
      "UPDATE enquiries SET status=$2, updated_at=now() WHERE id=$1 RETURNING *",
      [req.params.enquiryId, input.status],
    );
    if (!result.rowCount) throw new ApiError(404, "Enquiry not found", "ENQUIRY_NOT_FOUND");
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/enquiries/:enquiryId/followups", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  try {
    const input = z.object({
      note: z.string().trim().min(2).max(1000),
      followUpAt: z.string().datetime().optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO enquiry_followups (enquiry_id, note, follow_up_at, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.enquiryId, input.note, input.followUpAt ?? null, req.auth?.id ?? null],
    );
    await db().query(
      "UPDATE enquiries SET status='follow_up', updated_at=now() WHERE id=$1",
      [req.params.enquiryId],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/quotations", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  try {
    const input = z.object({
      enquiryId: z.string().uuid().optional(),
      memberId: z.string().uuid().optional(),
      subtotal: z.coerce.number().min(0),
      taxAmount: z.coerce.number().min(0).default(0),
      validUntil: z.string().date().optional(),
    }).parse(req.body);
    const quotationNumber = `QT-${Date.now()}`;
    const result = await db().query(
      `INSERT INTO quotations
         (quotation_number, enquiry_id, member_id, subtotal, tax_amount, total_amount, valid_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [quotationNumber, input.enquiryId ?? null, input.memberId ?? null,
       input.subtotal, input.taxAmount, input.subtotal + input.taxAmount,
       input.validUntil ?? null],
    );
    if (input.enquiryId) {
      await db().query("UPDATE enquiries SET status='quoted', updated_at=now() WHERE id=$1", [input.enquiryId]);
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch("/quotations/:quotationId/status", requireAuth, requirePermission("members.write"), async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["draft", "sent", "accepted", "rejected", "expired", "converted"]),
    }).parse(req.body);
    const result = await db().query(
      "UPDATE quotations SET status=$2 WHERE id=$1 RETURNING *",
      [req.params.quotationId, input.status],
    );
    if (!result.rowCount) throw new ApiError(404, "Quotation not found", "QUOTATION_NOT_FOUND");
    if (input.status === "converted" && result.rows[0].enquiry_id) {
      await db().query(
        "UPDATE enquiries SET status='converted', updated_at=now() WHERE id=$1",
        [result.rows[0].enquiry_id],
      );
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/staff", requireAuth, requirePermission("staff.provision"), async (req, res, next) => {
  try {
    const input = z.object({
      accountId: z.string().uuid().optional(),
      fullName: z.string().trim().min(2).max(120),
      department: z.string().trim().min(2).max(80),
      baseSalary: z.coerce.number().min(0).optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO staff_profiles (account_id, employee_number, full_name, department, base_salary)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.accountId ?? null, `EMP-${Date.now()}`, input.fullName, input.department, input.baseSalary ?? null],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/staff/:staffId/shifts", requireAuth, requirePermission("staff.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      role: z.string().trim().min(2).max(80),
      breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
    }).parse(req.body);
    const result = await db().query(
      "INSERT INTO staff_shifts (staff_id, starts_at, ends_at, role, break_minutes) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.staffId, input.startsAt, input.endsAt, input.role, input.breakMinutes],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/staff/:staffId/leave", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      startsAt: z.string().date(),
      endsAt: z.string().date(),
      reason: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const result = await db().query(
      "INSERT INTO leave_requests (staff_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING *",
      [req.params.staffId, input.startsAt, input.endsAt, input.reason ?? null],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch("/leave/:leaveId", requireAuth, requirePermission("staff.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({ status: z.enum(["approved", "rejected"]) }).parse(req.body);
    await client.query("BEGIN");
    const request = await client.query(
      "SELECT * FROM leave_requests WHERE id=$1 AND status='pending' FOR UPDATE",
      [req.params.leaveId],
    );
    if (!request.rowCount) throw new ApiError(404, "Pending leave request not found", "LEAVE_NOT_FOUND");
    const result = await client.query(
      `UPDATE leave_requests
       SET status=$2, reviewed_by=$3, reviewed_at=now()
       WHERE id=$1 AND status='pending' RETURNING *`,
      [req.params.leaveId, input.status, req.auth?.id ?? null],
    );
    if (input.status === "approved") {
      const start = new Date(request.rows[0].starts_at);
      const end = new Date(request.rows[0].ends_at);
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      await client.query(
        "UPDATE staff_profiles SET used_leave_days=used_leave_days+$2 WHERE id=$1",
        [request.rows[0].staff_id, days],
      );
    }
    await client.query("COMMIT");
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

operationsRouter.get("/staff/:staffId/leave/balance", requireAuth, async (req, res, next) => {
  try {
    const result = await db().query(
      `SELECT employee_number, annual_leave_days, used_leave_days,
              annual_leave_days-used_leave_days AS remaining_leave_days
       FROM staff_profiles WHERE id=$1`,
      [req.params.staffId],
    );
    if (!result.rowCount) throw new ApiError(404, "Staff profile not found", "STAFF_NOT_FOUND");
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/staff/departments/report", requireAuth, requirePermission("staff.manage"), async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT department,
              count(*)::int AS staff_count,
              count(*) FILTER (WHERE status='active')::int AS active_staff,
              COALESCE(sum(base_salary),0)::numeric AS base_salary_total
       FROM staff_profiles
       GROUP BY department
       ORDER BY department`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/expenses", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      category: z.string().trim().min(2).max(80),
      description: z.string().trim().min(2).max(500),
      amount: z.coerce.number().min(0),
      expenseDate: z.string().date().optional(),
      vendor: z.string().trim().max(120).optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO expenses (category, description, amount, expense_date, vendor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.category, input.description, input.amount, input.expenseDate ?? new Date().toISOString().slice(0, 10),
       input.vendor ?? null, req.auth?.id ?? null],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/invoices", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      businessName: z.string().trim().min(2).max(160),
      billingEmail: z.string().email().optional(),
      items: z.array(z.object({
        description: z.string().trim().min(2).max(300),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
      })).min(1),
      taxAmount: z.coerce.number().min(0).default(0),
      dueAt: z.string().date().optional(),
    }).parse(req.body);
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let taxAmount = input.taxAmount;
    if (taxAmount === 0) {
      const activeTax = await db().query(
        `SELECT rate_percent FROM tax_rates
         WHERE is_active=true AND applies_from<=CURRENT_DATE
           AND (applies_until IS NULL OR applies_until>=CURRENT_DATE)
         ORDER BY applies_from DESC LIMIT 1`,
      );
      if (activeTax.rowCount) {
        taxAmount = subtotal * Number(activeTax.rows[0].rate_percent) / 100;
      }
    }
    const invoiceNumber = `INV-${Date.now()}`;
    const result = await db().query(
      `INSERT INTO invoices
         (invoice_number, business_name, billing_email, subtotal, tax_amount, total_amount, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [invoiceNumber, input.businessName, input.billingEmail ?? null,
       subtotal, taxAmount, subtotal + taxAmount, input.dueAt ?? null],
    );
    for (const item of input.items) {
      await db().query(
        "INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)",
        [result.rows[0].id, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice],
      );
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/payroll", requireAuth, requirePermission("payroll.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      staffId: z.string().uuid(),
      periodStart: z.string().date(),
      periodEnd: z.string().date(),
      grossAmount: z.coerce.number().min(0),
      deductions: z.coerce.number().min(0).default(0),
      status: z.enum(["estimated", "approved", "paid"]).default("estimated"),
    }).parse(req.body);
    const netAmount = Math.max(0, input.grossAmount - input.deductions);
    const result = await db().query(
      `INSERT INTO payroll_records
         (staff_id, period_start, period_end, gross_amount, deductions, net_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.staffId, input.periodStart, input.periodEnd, input.grossAmount, input.deductions, netAmount, input.status],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/reports/performance", requireAuth, requirePermission("finance.read"), async (req, res, next) => {
  try {
    const input = z.object({
      from: z.string().date(),
      to: z.string().date(),
    }).parse(req.query);
    const court = await db().query(
      `SELECT COALESCE(sum(final_amount),0)::numeric AS revenue
       FROM court_reservations WHERE status='confirmed' AND starts_at >= $1::date AND starts_at < ($2::date + 1)`,
      [input.from, input.to],
    );
    const shop = await db().query(
      `SELECT COALESCE(sum(total_amount),0)::numeric AS revenue
       FROM shop_orders WHERE status IN ('confirmed','fulfilled') AND created_at >= $1::date AND created_at < ($2::date + 1)`,
      [input.from, input.to],
    );
    const bar = await db().query(
      `SELECT COALESCE(sum(amount),0)::numeric AS revenue
       FROM cafeteria_payments WHERE status='recorded' AND created_at >= $1::date AND created_at < ($2::date + 1)`,
      [input.from, input.to],
    );
    const expenses = await db().query(
      `SELECT COALESCE(sum(amount),0)::numeric AS amount
       FROM expenses WHERE status <> 'void' AND expense_date >= $1::date AND expense_date <= $2::date`,
      [input.from, input.to],
    );
    const payroll = await db().query(
      `SELECT COALESCE(sum(net_amount),0)::numeric AS liabilities
       FROM payroll_records WHERE status <> 'paid'`,
    );
    const courtRevenue = Number(court.rows[0].revenue);
    const shopRevenue = Number(shop.rows[0].revenue);
    const barRevenue = Number(bar.rows[0].revenue);
    const expenseAmount = Number(expenses.rows[0].amount);
    res.status(200).json({
      success: true,
      data: {
        period: { from: input.from, to: input.to },
        revenue: {
          courts: courtRevenue,
          shop: shopRevenue,
          cafeteria: barRevenue,
          total: courtRevenue + shopRevenue + barRevenue,
        },
        expenses: expenseAmount,
        netBeforeTax: courtRevenue + shopRevenue + barRevenue - expenseAmount,
        payrollLiabilities: Number(payroll.rows[0].liabilities),
      },
    });
  } catch (error) {
    next(error);
  }
});
