import { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { ApiError } from "../middleware/errors.js";
import { readUiSession } from "../auth/auth.js";
import { logger } from "../logger.js";

export const demoSyncRouter = Router();
const allowedRoles = new Set(["admin", "manager"]);
const stateInput = z.object({
  version: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()),
});
const publicCourtSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  price: z.coerce.number(),
  status: z.string(),
});
const publicBookingSchema = z.object({
  courtId: z.string(),
  date: z.string().date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().positive().optional(),
  status: z.string(),
}).passthrough();
const publicProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.coerce.number(),
  icon: z.string().optional(),
});
const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: z.string(),
  expiry: z.string(),
  phone: z.string(),
  balance: z.coerce.number(),
});
const memberOrderSchema = z.object({
  id: z.string(),
  memberId: z.string().nullable(),
  channel: z.string(),
  fulfillment: z.string(),
  status: z.string(),
  total: z.coerce.number(),
  date: z.string(),
});
const publicPlanSchema = z.object({
  name: z.string(),
  price: z.coerce.number(),
  courtDiscount: z.coerce.number(),
  shopDiscount: z.coerce.number(),
  barDiscount: z.coerce.number(),
  freeSessions: z.coerce.number(),
});

function getUiSession(req: Request) {
  const cookie = req.headers.cookie?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("playpulse_ui="))
    ?.slice("playpulse_ui=".length);
  return readUiSession(cookie);
}

function requireDemoStaff(req: Request, _res: Response, next: NextFunction) {
  const session = getUiSession(req);
  if (!session) {
    next(new ApiError(401, "A signed-in staff session is required", "UNAUTHORIZED"));
  } else if (!allowedRoles.has(session.role)) {
    next(new ApiError(403, "Staff access is required", "FORBIDDEN"));
  } else {
    next();
  }
}

function database() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

async function openEventStream(_req: Request, res: Response, next: NextFunction) {
  let client: PoolClient | undefined;
  let onClientError: ((error: Error) => void) | undefined;
  try {
    client = await database().connect();
    const streamClient = client;
    let streamReady = false;
    let released = false;
    let closeStream: (error?: Error) => void = () => {};
    onClientError = (error) => {
      logger.warn({ err: error }, "Demo data event stream database connection lost");
      if (!streamReady) return;
      closeStream(error);
      if (!res.writableEnded) res.end();
    };
    streamClient.on("error", onClientError);
    await streamClient.query("LISTEN playpulse_demo_data");
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);

    const onNotification = (notification: { channel?: string; payload?: string }) => {
      if (notification.channel === "playpulse_demo_data" && notification.payload) {
        res.write(`data: ${JSON.stringify({ version: Number(notification.payload) })}\n\n`);
      }
    };
    closeStream = (error) => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      streamClient.off("notification", onNotification);
      if (onClientError) streamClient.off("error", onClientError);
      streamClient.release(error);
    };
    streamClient.on("notification", onNotification);
    res.on("close", () => closeStream());
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    streamReady = true;
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
  } catch (error) {
    if (client) {
      if (onClientError) client.off("error", onClientError);
      client.release(error instanceof Error ? error : undefined);
    }
    next(error);
  }
}

demoSyncRouter.get("/public/events", openEventStream);
demoSyncRouter.get("/events", requireDemoStaff, openEventStream);

demoSyncRouter.get("/public", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const result = await database().query(
      `SELECT state, version, updated_at
       FROM shared_demo_state
       WHERE singleton_key=1`,
    );
    const row = result.rows[0];
    if (!row) {
      res.status(200).json({ success: true, data: { state: null, version: 0, updatedAt: null } });
      return;
    }
    const state = row.state as Record<string, unknown>;
    const session = getUiSession(_req);
    const courts = z.array(publicCourtSchema).parse(state.courts ?? []);
    const bookings = z.array(publicBookingSchema).parse(state.bookings ?? []);
    const products = z.array(publicProductSchema).parse(state.products ?? []);
    const members = z.array(memberSchema).parse(state.members ?? []);
    const orders = z.array(memberOrderSchema).parse(state.orders ?? []);
    const plans = z.array(publicPlanSchema).parse(state.plans ?? []);
    const activeBookings = bookings.filter((booking) =>
      !["cancelled", "rejected"].includes(booking.status.toLowerCase()));
    const member = session?.role === "member"
      ? members.find((item) => item.id === "M-1001") ?? null
      : null;
    res.status(200).json({
      success: true,
      data: {
        version: Number(row.version),
        updatedAt: row.updated_at,
        state: {
          courts,
          plans,
          bookings: activeBookings.map((booking) => ({
            courtId: booking.courtId,
            date: booking.date,
            time: booking.time,
            durationMinutes: booking.durationMinutes,
            status: booking.status,
          })),
          ...(session?.role === "member" ? {
            member,
            memberOrders: orders.filter((order) => order.memberId === "M-1001"),
            memberBookings: activeBookings
              .filter((booking) => booking.memberId === "M-1001" || booking.participantName === session.name)
              .map((booking) => ({
                courtId: booking.courtId,
                date: booking.date,
                time: booking.time,
                status: booking.status,
              })),
          } : {}),
          products,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

demoSyncRouter.get("/", requireDemoStaff, async (_req, res, next) => {
  try {
    const result = await database().query(
      `SELECT state, version, updated_at
       FROM shared_demo_state
       WHERE singleton_key=1`,
    );
    const row = result.rows[0];
    res.status(200).json({
      success: true,
      data: {
        state: row?.state ?? null,
        version: Number(row?.version ?? 0),
        updatedAt: row?.updated_at ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

demoSyncRouter.post("/public/bookings", async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      courtId: z.string().min(1).max(64),
      date: z.string().date(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    }).parse(req.body);
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT state FROM shared_demo_state WHERE singleton_key=1 FOR UPDATE",
    );
    if (!current.rowCount) throw new ApiError(503, "Shared demo data has not been initialized", "DEMO_DATA_NOT_INITIALIZED");

    const state = current.rows[0].state as Record<string, unknown>;
    const courts = z.array(publicCourtSchema).parse(state.courts ?? []);
    const bookings = z.array(publicBookingSchema).parse(state.bookings ?? []);
    const court = courts.find((item) => item.id === input.courtId && item.status === "Available");
    if (!court) throw new ApiError(404, "Court is not available", "COURT_NOT_AVAILABLE");

    const [hour, minute] = input.time.split(":").map(Number);
    if (hour > 23 || minute > 59 || minute % 30 !== 0) {
      throw new ApiError(400, "Booking time must use a valid 30-minute interval", "INVALID_BOOKING_INTERVAL");
    }
    const requestedStart = hour * 60 + minute;
    const overlap = bookings.some((booking) => {
      if (booking.courtId !== input.courtId || booking.date !== input.date ||
          ["cancelled", "rejected"].includes(booking.status.toLowerCase())) return false;
      const [bookedHour, bookedMinute] = booking.time.split(":").map(Number);
      const bookedStart = bookedHour * 60 + bookedMinute;
      return requestedStart < bookedStart + (booking.durationMinutes ?? 60) &&
        bookedStart < requestedStart + 60;
    });
    if (overlap) throw new ApiError(409, "Court is already reserved for an overlapping time", "COURT_CONFLICT");

    const session = getUiSession(req);
    const reservation = {
      id: `B-${randomUUID()}`,
      memberId: session?.role === "member" ? "M-1001" : null,
      participantName: session?.role === "member" ? session.name : "Visitor",
      courtId: input.courtId,
      court: court.name,
      date: input.date,
      time: input.time,
      status: "Confirmed",
      amount: session?.role === "member" ? 0 : court.price,
    };
    const nextState = {
      ...state,
      bookings: [...(Array.isArray(state.bookings) ? state.bookings : []), reservation],
    };
    const updated = await client.query(
      `UPDATE shared_demo_state
       SET state=$1::jsonb, version=version+1, updated_at=now(), updated_by=$2
       WHERE singleton_key=1
       RETURNING version`,
      [JSON.stringify(nextState), session?.email ?? "visitor"],
    );
    const version = Number(updated.rows[0].version);
    await client.query("SELECT pg_notify('playpulse_demo_data', $1)", [String(version)]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: { reservation, version } });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

demoSyncRouter.put("/", requireDemoStaff, async (req, res, next) => {
  const client = pool ? await pool.connect() : null;
  try {
    if (!client) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = stateInput.parse(req.body);
    const session = getUiSession(req);
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO shared_demo_state (singleton_key, state, version, updated_by)
       VALUES (1, $1::jsonb, 1, $3)
       ON CONFLICT (singleton_key) DO UPDATE
         SET state=EXCLUDED.state,
             version=shared_demo_state.version+1,
             updated_at=now(),
             updated_by=EXCLUDED.updated_by
       WHERE shared_demo_state.version=$2
       RETURNING version, updated_at`,
      [JSON.stringify(input.data), input.version, session?.email ?? null],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      const current = await database().query(
        "SELECT version FROM shared_demo_state WHERE singleton_key=1",
      );
      res.status(409).json({
        success: false,
        error: {
          code: "DEMO_DATA_CONFLICT",
          message: "Shared data changed; refresh before saving again",
        },
        currentVersion: Number(current.rows[0]?.version ?? 0),
      });
      return;
    }

    const version = Number(result.rows[0].version);
    await client.query("SELECT pg_notify('playpulse_demo_data', $1)", [String(version)]);
    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      data: { version, updatedAt: result.rows[0].updated_at },
    });
  } catch (error) {
    await client?.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});
