import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { pool } from "../database/pool.js";
import { requireAuth, requirePermission } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";
import { logger } from "../logger.js";

export const monitoringRouter = Router();

let requestsTotal = 0;
let requestsSucceeded = 0;
let requestsFailed = 0;
let databaseLatencyMs = 0;

export function recordRequest(success: boolean): void {
  requestsTotal++;
  if (success) requestsSucceeded++;
  else requestsFailed++;
}

export function recordDatabaseLatency(milliseconds: number): void {
  databaseLatencyMs = milliseconds;
}

export function prometheusMetricsText(): string {
  return [
    "# HELP playpulse_http_requests_total Total HTTP requests received.",
    "# TYPE playpulse_http_requests_total counter",
    `playpulse_http_requests_total ${requestsTotal}`,
    "# HELP playpulse_http_requests_succeeded_total Successful HTTP requests.",
    "# TYPE playpulse_http_requests_succeeded_total counter",
    `playpulse_http_requests_succeeded_total ${requestsSucceeded}`,
    "# HELP playpulse_http_requests_failed_total Failed HTTP requests.",
    "# TYPE playpulse_http_requests_failed_total counter",
    `playpulse_http_requests_failed_total ${requestsFailed}`,
    "# HELP playpulse_database_last_latency_ms Last database latency measurement.",
    "# TYPE playpulse_database_last_latency_ms gauge",
    `playpulse_database_last_latency_ms ${databaseLatencyMs}`,
  ].join("\n") + "\n";
}

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

monitoringRouter.get("/metrics", (_req, res) => {
  const lines = [
    "# HELP playpulse_http_requests_total Total HTTP requests received.",
    "# TYPE playpulse_http_requests_total counter",
    `playpulse_http_requests_total ${requestsTotal}`,
    "# HELP playpulse_http_requests_succeeded_total Successful HTTP requests.",
    "# TYPE playpulse_http_requests_succeeded_total counter",
    `playpulse_http_requests_succeeded_total ${requestsSucceeded}`,
    "# HELP playpulse_http_requests_failed_total Failed HTTP requests.",
    "# TYPE playpulse_http_requests_failed_total counter",
    `playpulse_http_requests_failed_total ${requestsFailed}`,
    "# HELP playpulse_database_last_latency_ms Last database latency measurement.",
    "# TYPE playpulse_database_last_latency_ms gauge",
    `playpulse_database_last_latency_ms ${databaseLatencyMs}`,
  ];
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.status(200).send(`${lines.join("\n")}\n`);
});

monitoringRouter.get("/observability/slow-queries", requireAuth, requirePermission("finance.read"), async (_req, res, next) => {
  try {
    const result = await db().query(
      `SELECT query_name,duration_ms,threshold_ms,metadata,created_at
       FROM slow_query_events ORDER BY created_at DESC LIMIT 500`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.get("/observability/backups", requireAuth, requirePermission("finance.read"), async (_req, res, next) => {
  try {
    const result = await db().query(
      "SELECT * FROM backup_records ORDER BY started_at DESC LIMIT 500",
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post("/observability/backups", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      backupName: z.string().trim().min(2).max(200),
      status: z.enum(["started", "succeeded", "failed"]),
      sizeBytes: z.coerce.number().int().min(0).optional(),
      errorMessage: z.string().trim().max(1000).optional(),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO backup_records
         (backup_name,status,size_bytes,error_message,completed_at)
       VALUES ($1,$2,$3,$4,CASE WHEN $2='started' THEN NULL ELSE now() END)
       RETURNING *`,
      [input.backupName, input.status, input.sizeBytes ?? null, input.errorMessage ?? null],
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

monitoringRouter.post("/observability/slow-queries", requireAuth, requirePermission("finance.manage"), async (req, res, next) => {
  try {
    const input = z.object({
      queryName: z.string().trim().min(2).max(200),
      durationMs: z.coerce.number().int().min(0),
      thresholdMs: z.coerce.number().int().min(0).default(500),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO slow_query_events (query_name,duration_ms,threshold_ms,metadata)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.queryName, input.durationMs, input.thresholdMs, JSON.stringify(input.metadata)],
    );
    if (input.durationMs >= input.thresholdMs) {
      logger.warn({
        queryName: input.queryName,
        durationMs: input.durationMs,
        thresholdMs: input.thresholdMs,
      }, "Slow query threshold reached");
    }
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

async function performanceData(from: string, to: string) {
  const court = await db().query(
    `SELECT COALESCE(sum(final_amount),0)::numeric AS revenue
     FROM court_reservations WHERE status='confirmed' AND starts_at>= $1::date AND starts_at<($2::date+1)`,
    [from, to],
  );
  const shop = await db().query(
    `SELECT COALESCE(sum(total_amount),0)::numeric AS revenue
     FROM shop_orders WHERE status IN ('confirmed','fulfilled') AND created_at>= $1::date AND created_at<($2::date+1)`,
    [from, to],
  );
  const cafeteria = await db().query(
    `SELECT COALESCE(sum(amount),0)::numeric AS revenue
     FROM cafeteria_payments WHERE status='recorded' AND created_at>= $1::date AND created_at<($2::date+1)`,
    [from, to],
  );
  const expenses = await db().query(
    `SELECT COALESCE(sum(amount),0)::numeric AS amount
     FROM expenses WHERE status<> 'void' AND expense_date>= $1::date AND expense_date<= $2::date`,
    [from, to],
  );
  return [
    { source: "Courts", revenue: Number(court.rows[0].revenue) },
    { source: "Shop", revenue: Number(shop.rows[0].revenue) },
    { source: "Cafeteria", revenue: Number(cafeteria.rows[0].revenue) },
    { source: "Expenses", revenue: -Number(expenses.rows[0].amount) },
  ];
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

monitoringRouter.get("/reports/export", requireAuth, requirePermission("finance.read"), async (req, res, next) => {
  try {
    const input = z.object({
      format: z.enum(["csv", "xlsx", "pdf"]),
      from: z.string().date(),
      to: z.string().date(),
      report: z.enum(["performance", "invoices", "tax"]).default("performance"),
    }).parse(req.query);

    let rows: Record<string, unknown>[] = [];
    if (input.report === "performance") {
      rows = await performanceData(input.from, input.to) as Record<string, unknown>[];
    } else if (input.report === "invoices") {
      const result = await db().query(
        `SELECT invoice_number,business_name,subtotal,tax_amount,total_amount,
                paid_amount,total_amount-paid_amount AS balance,status,due_at
         FROM invoices
         WHERE issued_at>= $1::date AND issued_at<($2::date+1)
         ORDER BY issued_at`,
        [input.from, input.to],
      );
      rows = result.rows;
    } else {
      const result = await db().query(
        `SELECT issued_at,COALESCE(sum(tax_amount),0)::numeric AS tax_amount
         FROM invoices
         WHERE issued_at>= $1::date AND issued_at<($2::date+1)
         GROUP BY issued_at ORDER BY issued_at`,
        [input.from, input.to],
      );
      rows = result.rows;
    }

    const columns = rows.length
      ? Object.keys(rows[0])
      : ["No records"];
    const baseName = `playpulse-${input.report}-${input.from}-${input.to}`;

    if (input.format === "csv") {
      const csv = [
        columns.join(","),
        ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`);
      res.status(200).send(`\ufeff${csv}`);
      return;
    }

    if (input.format === "xlsx") {
      const xmlEscape = (value: unknown) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const allRows = [
        columns,
        ...rows.map((row) => columns.map((column) => row[column] ?? "")),
      ];
      const sheetRows = allRows.map((row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
          const reference = `${String.fromCharCode(65 + (columnIndex % 26))}${rowIndex + 1}`;
          return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        }).join("")}</row>`,
      ).join("");
      const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
      const zip = new JSZip();
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
      zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
      zip.folder("xl")?.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${input.report}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
      zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
      zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", worksheet);
      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.xlsx"`);
      res.status(200).send(buffer);
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`);
    const document = new PDFDocument({ margin: 40 });
    document.pipe(res);
    document.fontSize(18).text(`PlayPulse ${input.report.toUpperCase()} Report`);
    document.moveDown();
    document.fontSize(10).text(`Period: ${input.from} to ${input.to}`);
    document.moveDown();
    for (const row of rows) {
      document.fontSize(10).text(columns.map((column) => `${column}: ${row[column] ?? ""}`).join(" | "));
    }
    document.end();
  } catch (error) {
    next(error);
  }
});
