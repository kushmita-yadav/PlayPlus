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

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      service: "playpulse",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req: Request, res: Response) => {
    const database = await checkDatabase();
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

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
}
