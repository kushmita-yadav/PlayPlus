import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const hardeningRouter = Router();

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

hardeningRouter.get("/public/clubs/champions", async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT s.code, s.name,
              COALESCE(json_agg(json_build_object(
                'id', c.id, 'code', c.code, 'name', c.name,
                'baseHourlyPrice', c.base_hourly_price,
                'isActive', c.is_active
              ) ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS courts
       FROM sports s
       LEFT JOIN courts c ON c.sport_id=s.id
       WHERE s.is_active=true
       GROUP BY s.id, s.code, s.name
       ORDER BY s.name`,
    );
    const plans = await db().query(
      `SELECT code, name, description, monthly_price, benefits
       FROM membership_plans WHERE is_active=true ORDER BY monthly_price`,
    );
    res.status(200).json({
      success: true,
      data: {
        name: "The Champions Club",
        sports: result.rows,
        membershipPlans: plans.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/public/trials", async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(7).max(20),
      email: z.string().email().optional(),
      sportCode: z.enum(["TENNIS", "PADEL", "BADMINTON", "CRICKET"]),
      preferredAt: z.string().datetime(),
      notes: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const enquiry = await db().query(
      `INSERT INTO enquiries (name, phone, email, interest, source)
       VALUES ($1,$2,$3,$4,'trial') RETURNING *`,
      [input.name, input.phone, input.email ?? null,
       `${input.sportCode} trial at ${input.preferredAt}${input.notes ? `: ${input.notes}` : ""}`],
    );
    res.status(201).json({
      success: true,
      data: {
        enquiryId: enquiry.rows[0].id,
        status: "new",
        sportCode: input.sportCode,
        preferredAt: input.preferredAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.get("/public/shop/products", async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT id, sku, name, description, category, price
       FROM shop_products
       WHERE is_active=true AND stock_quantity > 0
       ORDER BY category, name`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.get("/tax-rates", requireAuth, requirePermission("finance.read"), async (_req, res, next) => {
  try {
    const result = await db().query(
      "SELECT * FROM tax_rates WHERE is_active=true ORDER BY applies_from DESC",
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/tax-rates", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      code: z.string().trim().min(2).max(30),
      name: z.string().trim().min(2).max(120),
      ratePercent: z.coerce.number().min(0).max(100),
      appliesFrom: z.string().date(),
      appliesUntil: z.string().date().optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO tax_rates (code, name, rate_percent, applies_from, applies_until)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.code.toUpperCase(), input.name, input.ratePercent,
       input.appliesFrom, input.appliesUntil ?? null],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/invoices/:invoiceId/payments", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      amount: z.coerce.number().positive(),
      method: z.enum(["cash", "card", "upi", "bank", "online"]),
      reference: z.string().trim().max(200).optional(),
    }).parse(req.body);
    await client.query("BEGIN");
    const invoice = await client.query(
      "SELECT * FROM invoices WHERE id=$1 FOR UPDATE",
      [req.params.invoiceId],
    );
    if (!invoice.rowCount) throw new ApiError(404, "Invoice not found", "INVOICE_NOT_FOUND");
    const nextPaid = Number(invoice.rows[0].paid_amount) + input.amount;
    if (nextPaid > Number(invoice.rows[0].total_amount)) {
      throw new ApiError(409, "Payment exceeds invoice balance", "INVOICE_OVERPAYMENT");
    }
    await client.query(
      "INSERT INTO invoice_payments (invoice_id, amount, method, reference) VALUES ($1,$2,$3,$4)",
      [req.params.invoiceId, input.amount, input.method, input.reference ?? null],
    );
    const status = nextPaid === 0 ? "issued"
      : nextPaid < Number(invoice.rows[0].total_amount) ? "partially_paid" : "paid";
    await client.query(
      "UPDATE invoices SET paid_amount=$2, status=$3 WHERE id=$1",
      [req.params.invoiceId, nextPaid, status],
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: {
        invoiceId: req.params.invoiceId,
        paidAmount: nextPaid,
        balance: Number(invoice.rows[0].total_amount) - nextPaid,
        status,
      },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

hardeningRouter.get("/invoices/aging", requireAuth, requirePermission("finance.read"), async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT
         id, invoice_number, business_name, total_amount, paid_amount,
         total_amount-paid_amount AS outstanding,
         due_at,
         CASE
           WHEN due_at IS NULL THEN 'no_due_date'
           WHEN due_at >= CURRENT_DATE THEN 'current'
           WHEN due_at >= CURRENT_DATE-interval '30 days' THEN '1-30'
           WHEN due_at >= CURRENT_DATE-interval '60 days' THEN '31-60'
           WHEN due_at >= CURRENT_DATE-interval '90 days' THEN '61-90'
           ELSE '90-plus'
         END AS aging_bucket
       FROM invoices
       WHERE status NOT IN ('paid','void') AND paid_amount < total_amount
       ORDER BY due_at NULLS LAST`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/expense-claims", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      staffId: z.string().uuid(),
      category: z.string().trim().min(2).max(80),
      description: z.string().trim().min(2).max(500),
      amount: z.coerce.number().positive(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO expense_claims (staff_id, category, description, amount)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.staffId, input.category, input.description, input.amount],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.patch("/expense-claims/:claimId", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["approved", "rejected", "paid"]) }).parse(req.body);
    const result = await db().query(
      `UPDATE expense_claims
       SET status=$2, approved_by=$3, reviewed_at=now()
       WHERE id=$1 AND status='submitted' RETURNING *`,
      [req.params.claimId, input.status, req.auth?.id ?? null],
    );
    if (!result.rowCount) throw new ApiError(404, "Submitted claim not found", "CLAIM_NOT_FOUND");
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/ledger/journals/:journalId/reconciliation", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({ description: z.string().trim().max(500).optional() }).parse(req.body);
    const result = await db().query(
      `SELECT COALESCE(sum(debit),0)::numeric AS debits,
              COALESCE(sum(credit),0)::numeric AS credits
       FROM ledger_entries WHERE journal_id=$1`,
      [req.params.journalId],
    );
    const debits = Number(result.rows[0].debits);
    const credits = Number(result.rows[0].credits);
    res.status(200).json({
      success: true,
      data: {
        journalId: req.params.journalId,
        debits,
        credits,
        balanced: debits === credits,
        description: input.description ?? null,
      },
    });

    hardeningRouter.post("/ledger/journals/:journalId/entries", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
      try {
        const input = z.object({
          accountCode: z.string().trim().min(1).max(30),
          debit: z.coerce.number().min(0).default(0),
          credit: z.coerce.number().min(0).default(0),
          referenceType: z.string().trim().max(80).optional(),
          referenceId: z.string().trim().max(200).optional(),
          description: z.string().trim().max(500).optional(),
        }).parse(req.body);
        if ((input.debit > 0 && input.credit > 0) || (input.debit === 0 && input.credit === 0)) {
          throw new ApiError(400, "Exactly one of debit or credit must be positive", "INVALID_LEDGER_ENTRY");
        }
        const account = await db().query(
          "SELECT id FROM ledger_accounts WHERE code=$1 AND is_active=true",
          [input.accountCode],
        );
        if (!account.rowCount) throw new ApiError(404, "Ledger account not found", "LEDGER_ACCOUNT_NOT_FOUND");
        const result = await db().query(
          `INSERT INTO ledger_entries
             (journal_id, account_id, debit, credit, reference_type, reference_id, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [req.params.journalId, account.rows[0].id, input.debit, input.credit,
           input.referenceType ?? null, input.referenceId ?? null, input.description ?? null],
        );
        res.status(201).json({ success: true, data: result.rows[0] });
      } catch (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.post("/security/audit", requireAuth, requirePermission("auth.admin"), async (req, res, next) => {
  try {
    const input = z.object({
      eventType: z.string().trim().min(2).max(80),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO security_audit_events
         (account_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.auth?.id ?? null, input.eventType, req.ip || null,
       req.get("user-agent") ?? null, JSON.stringify(input.metadata)],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

hardeningRouter.get("/receipts", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      sourceType: z.enum(["shop", "cafeteria", "court", "membership"]).optional(),
    }).parse(req.query);
    const result = await db().query(
      `SELECT * FROM receipt_records
       WHERE ($1::text IS NULL OR source_type=$1)
       ORDER BY created_at DESC LIMIT 500`,
      [input.sourceType ?? null],
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});
