import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { checkDatabase, pool } from "./database/pool.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { authRouter } from "./auth/routes.js";
import { membershipRouter } from "./memberships/routes.js";
import { courtRouter } from "./courts/routes.js";
import { shopRouter } from "./shop/routes.js";
import { cafeteriaRouter } from "./cafeteria/routes.js";
import { operationsRouter } from "./operations/routes.js";
import { assistantRouter } from "./assistant/routes.js";
import { hardeningRouter } from "./hardening/routes.js";
import { monitoringRouter, recordRequest, recordDatabaseLatency, prometheusMetricsText } from "./monitoring/routes.js";
import { notificationRouter } from "./notifications/routes.js";
import { demoSyncRouter } from "./demo-sync/routes.js";
import { readUiSession } from "./auth/auth.js";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "node:fs";
import path from "node:path";

const openapiDocument = JSON.parse(readFileSync(path.resolve(process.cwd(), "docs/openapi.json"), "utf8"));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.NODE_ENV === "production" ? false : true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use("/api", rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }));

  app.use((req, res, next) => {
    const requestId = req.header("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", requestId);
    next();
  });
  app.use((req, res, next) => {
    res.on("finish", () => {
      recordRequest(res.statusCode < 400);
    });
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      service: "playpulse",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/metrics", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.status(200).send(prometheusMetricsText());
  });

  app.get("/ready", async (_req: Request, res: Response) => {
    const database = await checkDatabase();
    recordDatabaseLatency(database.latencyMs ?? 0);
    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? "ready" : "not-ready",
      database,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/v1", (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        name: "PlayPulse",
        version: "v1",
        environment: env.NODE_ENV,
        timezone: env.CLUB_TIMEZONE,
      },
    });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/memberships", membershipRouter);
  app.use("/api/v1/courts", courtRouter);
  app.use("/api/v1/shop", shopRouter);
  app.use("/api/v1/cafeteria", cafeteriaRouter);
  app.use("/api/v1", operationsRouter);
  app.use("/api/v1", assistantRouter);
  app.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
  app.use("/api/v1/openapi.json", (_req: Request, res: Response) => {
    res.status(200).json(openapiDocument);
  });
  app.use("/api/v1", hardeningRouter);
  app.use("/api/v1", monitoringRouter);
  app.use("/api/v1", notificationRouter);
  app.use("/api/v1/demo-data", demoSyncRouter);

  const frontendDirectory = path.resolve(process.cwd(), "dist/frontend");
  const readUiCookie = (req: Request) => {
    const match = req.headers.cookie?.match(/(?:^|;\s*)playpulse_ui=([^;]+)/);
    return readUiSession(match ? decodeURIComponent(match[1]) : undefined);
  };
  const roleLevel = (role: string | undefined) => ({
    visitor: 0,
    member: 10,
    front_desk: 20,
    staff: 30,
    manager: 40,
    admin: 50,
  }[role ?? ""] ?? -1);

  app.use(express.static(frontendDirectory, { index: false }));
  app.use("/admin", (req: Request, res: Response, next) => {
    res.setHeader("Cache-Control", "no-store");
    const ui = readUiCookie(req);
    if (!ui) {
      res.redirect(302, "/");
    } else if (roleLevel(ui.role) < 20) {
      res.redirect(302, ui.role === "member" ? "/portal?mode=member" : "/visitor");
    } else {
      next();
    }
  });
  app.use(["/portal", "/visitor", "/"], (req: Request, res: Response, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(frontendDirectory, "index.html"));
  });
  app.get("/login", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDirectory, "index.html"));
  });
  app.get("/admin", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDirectory, "index.html"));
  });
  app.get("/portal", (_req: Request, res: Response) => {
    const ui = readUiCookie(_req);
    if (_req.query.mode === "member" && ui?.role !== "member") {
      res.redirect(302, "/");
      return;
    }
    res.sendFile(path.join(frontendDirectory, "index.html"));
  });
  app.get("/visitor", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDirectory, "index.html"));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
}
