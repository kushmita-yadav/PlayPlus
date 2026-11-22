import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../database/pool.js";
import { requireAuth } from "../auth/auth.js";
import { ApiError } from "../middleware/errors.js";

export const assistantRouter = Router();

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});
const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(10),
}).superRefine(({ messages }, context) => {
  if (messages[messages.length - 1]?.role !== "user") {
    context.addIssue({ code: "custom", path: ["messages"], message: "The last message must be from the user" });
  }
  if (messages.reduce((total, message) => total + message.content.length, 0) > 10_000) {
    context.addIssue({ code: "custom", path: ["messages"], message: "Conversation is too long" });
  }
});
const groqResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
  })).min(1),
});
const chatRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many assistant requests. Please try again shortly." },
    });
  },
});
const groqSystemPrompt = `You are PlayPulse Assistant for Champions Club, a sports club offering tennis, padel, badminton, cricket, memberships, court bookings, a sports shop, and a cafeteria.
Help visitors, members, and staff with general questions about sports, club services, booking steps, and how to use the PlayPulse website. Be friendly, concise, and respond in the user's language when practical.
You cannot access live availability, prices, accounts, orders, membership records, or internal club data unless that information is explicitly provided in the conversation. Never invent current club details; direct users to the relevant page or club staff for confirmation.
You cannot create or change bookings, payments, accounts, or records. Never request passwords, one-time codes, payment details, or other sensitive information.`;

assistantRouter.post("/assistant/chat", chatRateLimit, async (req, res, next) => {
  try {
    const input = chatRequestSchema.parse(req.body);
    if (!env.GROQ_API_KEY) {
      throw new ApiError(503, "The Groq assistant is not configured", "ASSISTANT_UNAVAILABLE");
    }

    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL,
          messages: [
            { role: "system", content: groqSystemPrompt },
            ...input.messages,
          ],
          max_completion_tokens: 512,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ApiError(504, "The assistant took too long to respond. Please try again.", "ASSISTANT_TIMEOUT");
      }
      throw new ApiError(503, "The assistant service is temporarily unavailable", "ASSISTANT_UNAVAILABLE");
    }

    if (response.status === 429) {
      throw new ApiError(503, "The assistant is busy. Please try again shortly.", "ASSISTANT_BUSY");
    }
    if (!response.ok) {
      throw new ApiError(502, "The assistant could not complete this request", "ASSISTANT_PROVIDER_ERROR");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(502, "The assistant returned an invalid response", "ASSISTANT_INVALID_RESPONSE");
    }
    const parsedResponse = groqResponseSchema.safeParse(payload);
    const reply = parsedResponse.success ? parsedResponse.data.choices[0].message.content?.trim() : "";
    if (!reply) {
      throw new ApiError(502, "The assistant returned an invalid response", "ASSISTANT_INVALID_RESPONSE");
    }

    res.status(200).json({ success: true, data: { reply } });
  } catch (error) {
    next(error);
  }
});

function db() {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  return pool;
}

function identifyIntent(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("cancel") || text.includes("recovery") || text.includes("alternative")) return "cancellation_recovery";
  if (text.includes("team") || text.includes("balance")) return "balanced_team";
  if (text.includes("match") || text.includes("player") || text.includes("partner")) return "matchmaking";
  if (text.includes("court") || text.includes("availability") || text.includes("book")) return "court_availability";
  if (text.includes("stock") || text.includes("low") || text.includes("inventory")) return "inventory";
  if (text.includes("revenue") || text.includes("sales") || text.includes("finance")) return "finance";
  return "help";
}

assistantRouter.post("/assistant/query", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      message: z.string().trim().min(2).max(1000),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(req.body);
    const intent = identifyIntent(input.message);
    let recommendations: unknown = [];
    let explanation = "";

    if (intent === "court_availability") {
      if (!["admin", "manager", "front_desk", "staff"].includes(req.auth!.role)) {
        throw new ApiError(403, "Court operations context is restricted", "FORBIDDEN");
      }
      const date = typeof input.context?.date === "string"
        ? input.context.date
        : new Date().toISOString().slice(0, 10);
      const result = await db().query(
        `SELECT c.id, c.name, c.session_duration_minutes,
                count(r.id)::int AS confirmed_reservations
         FROM courts c
         LEFT JOIN court_reservations r ON r.court_id=c.id
           AND r.status='confirmed'
           AND r.starts_at >= $1::date
           AND r.starts_at < ($1::date + interval '1 day')
         WHERE c.is_active=true
         GROUP BY c.id ORDER BY c.name`,
        [date],
      );
      recommendations = result.rows;
      explanation = `Analyzed active courts and confirmed reservations for ${date}.`;
    } else if (intent === "inventory") {
      if (!req.auth!.permissions.includes("shop.manage") && req.auth!.role !== "admin") {
        throw new ApiError(403, "Inventory context is restricted", "FORBIDDEN");
      }
      const result = await db().query(
        `SELECT id, name, stock_quantity, low_stock_threshold
         FROM shop_products
         WHERE is_active=true AND stock_quantity <= low_stock_threshold
         ORDER BY stock_quantity`,
      );
      recommendations = result.rows;
      explanation = "Listed products at or below their configured reorder threshold.";
    } else if (intent === "finance") {
      if (!req.auth!.permissions.includes("finance.read") && req.auth!.role !== "admin") {
        throw new ApiError(403, "Financial context is restricted", "FORBIDDEN");
      }
      const result = await db().query(
        `SELECT
           (SELECT COALESCE(sum(final_amount),0) FROM court_reservations WHERE status='confirmed') AS courts,
           (SELECT COALESCE(sum(total_amount),0) FROM shop_orders WHERE status IN ('confirmed','fulfilled')) AS shop,
           (SELECT COALESCE(sum(amount),0) FROM cafeteria_payments WHERE status='recorded') AS cafeteria`,
      );
      recommendations = result.rows[0];
      explanation = "Summed confirmed club revenue sources; refunds and voided records are excluded.";
    } else if (intent === "matchmaking") {
      recommendations = [{
        requestRequired: true,
        fields: ["memberId", "sportCode", "preferredStartsAt", "skillFloor", "skillCeiling"],
      }];
      explanation = "Create a matchmaking request to compare real player profiles.";
    } else if (intent === "cancellation_recovery") {
      recommendations = [];
      explanation = "Cancellation recovery is available for future confirmed reservations through the booking API.";
    } else if (intent === "balanced_team") {
      recommendations = [{
        teamGenerationRequired: true,
        endpoint: "/api/v1/assistant/balance-teams",
      }];
      explanation = "Provide a list of player members and skill levels to generate balanced teams.";
    } else {
      recommendations = [
        "Ask about court availability",
        "Ask about low-stock items",
        "Ask for financial revenue totals",
        "Create a matchmaking request",
      ];
      explanation = "General assistance is available for club operations.";
    }

    await db().query(
      `INSERT INTO assistant_action_history (account_id, intent, user_message, result)
       VALUES ($1,$2,$3,$4)`,
      [req.auth!.id, intent, input.message, JSON.stringify({ recommendations, explanation })],
    );
    res.status(200).json({
      success: true,
      data: { intent, recommendations, explanation, confirmed: false },
    });
  } catch (error) {
    next(error);
  }
});

assistantRouter.post("/assistant/matchmaking", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      memberId: z.string().uuid(),
      sportCode: z.string().trim().min(2).max(30),
      preferredStartsAt: z.string().datetime().optional(),
      skillFloor: z.coerce.number().int().min(1).max(5).optional(),
      skillCeiling: z.coerce.number().int().min(1).max(5).optional(),
    }).parse(req.body);
    if (req.auth!.role !== "admin" && req.auth!.id !== input.memberId) {
      throw new ApiError(403, "Cannot create matchmaking requests for another member", "FORBIDDEN");
    }
    const client = db();
    const request = await client.query(
      `INSERT INTO matchmaking_requests
         (requester_member_id, sport_code, preferred_starts_at, skill_floor, skill_ceiling)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.memberId, input.sportCode.toUpperCase(), input.preferredStartsAt ?? null,
       input.skillFloor ?? null, input.skillCeiling ?? null],
    );
    const profile = await client.query(
      "SELECT skill_level, preferred_sports FROM player_profiles WHERE member_id=$1",
      [input.memberId],
    );
    const requesterSkill = profile.rowCount ? Number(profile.rows[0].skill_level) : 3;
    const candidates = await client.query(
      `SELECT pp.member_id, pp.skill_level, pp.preferred_sports, m.full_name
       FROM player_profiles pp
       JOIN members m ON m.id=pp.member_id
       WHERE pp.member_id <> $1
         AND ($2::text = ANY(pp.preferred_sports) OR cardinality(pp.preferred_sports)=0)
         AND ($3::smallint IS NULL OR pp.skill_level >= $3)
         AND ($4::smallint IS NULL OR pp.skill_level <= $4)
       LIMIT 20`,
      [input.memberId, input.sportCode.toUpperCase(), input.skillFloor ?? null, input.skillCeiling ?? null],
    );
    const recommendations = candidates.rows.map((candidate) => {
      const difference = Math.abs(Number(candidate.skill_level) - requesterSkill);
      const sportFit = candidate.preferred_sports.includes(input.sportCode.toUpperCase()) ? 40 : 15;
      const skillFit = 60 - difference * 15;
      const score = Math.max(0, Math.min(100, sportFit + skillFit));
      return {
        memberId: candidate.member_id,
        name: candidate.full_name,
        compatibilityScore: score,
        explanation: {
          requesterSkill,
          candidateSkill: candidate.skill_level,
          sportPreferenceMatched: sportFit === 40,
          skillDifference: difference,
        },
      };
    }).sort((a, b) => b.compatibilityScore - a.compatibilityScore);
    for (const recommendation of recommendations) {
      await client.query(
        `INSERT INTO matchmaking_recommendations
           (request_id, member_id, compatibility_score, explanation)
         VALUES ($1,$2,$3,$4)`,
        [request.rows[0].id, recommendation.memberId, recommendation.compatibilityScore,
         JSON.stringify(recommendation.explanation)],
      );
    }
    res.status(201).json({ success: true, data: { request: request.rows[0], recommendations } });
  } catch (error) {
    next(error);
  }
});

assistantRouter.post("/assistant/balance-teams", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      players: z.array(z.object({
        memberId: z.string().uuid(),
        skillLevel: z.coerce.number().int().min(1).max(5),
      })).min(2).max(100),
    }).parse(req.body);
    const sorted = [...input.players].sort((a, b) => b.skillLevel - a.skillLevel);
    const teams: { id: number; players: typeof sorted; totalSkill: number }[] = [
      { id: 1, players: [], totalSkill: 0 },
      { id: 2, players: [], totalSkill: 0 },
    ];
    for (const player of sorted) {
      const target = teams[0].totalSkill <= teams[1].totalSkill ? teams[0] : teams[1];
      target.players.push(player);
      target.totalSkill += player.skillLevel;
    }
    const difference = Math.abs(teams[0].totalSkill - teams[1].totalSkill);
    res.status(200).json({
      success: true,
      data: {
        teams,
        skillDifference: difference,
        explanation: "Players are sorted by skill and assigned one at a time to the team with the lower total.",
      },
    });
  } catch (error) {
    next(error);
  }
});

assistantRouter.get("/assistant/cancellation-recovery/:reservationId", requireAuth, async (req, res, next) => {
  try {
    const reservation = await db().query(
      `SELECT r.id, r.court_id, r.starts_at, r.ends_at,
              c.name AS court_name
       FROM court_reservations r
       JOIN courts c ON c.id=r.court_id
       WHERE r.id=$1 AND r.status='confirmed'`,
      [req.params.reservationId],
    );
    if (!reservation.rowCount) {
      throw new ApiError(404, "Confirmed reservation not found", "RESERVATION_NOT_FOUND");
    }
    const row = reservation.rows[0];
    const alternatives = await db().query(
      `SELECT c.id, c.name
       FROM courts c
       WHERE c.is_active=true
         AND c.id <> $1
         AND NOT EXISTS (
           SELECT 1 FROM court_reservations r
           WHERE r.court_id=c.id AND r.status='confirmed'
             AND r.starts_at < $3 AND r.ends_at > $2
         )
       ORDER BY c.name LIMIT 5`,
      [row.court_id, row.starts_at, row.ends_at],
    );
    res.status(200).json({
      success: true,
      data: {
        cancelledReservation: row,
        alternatives: alternatives.rows,
        explanation: "Alternatives share the original time window and exclude courts with overlapping confirmed bookings.",
      },
    });
  } catch (error) {
    next(error);
  }
});

assistantRouter.post("/assistant/confirm", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      intent: z.string().trim().min(2).max(100),
      action: z.string().trim().min(2).max(1000),
      auditPayload: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);
    const result = await db().query(
      `INSERT INTO assistant_action_history
         (account_id, intent, user_message, result, confirmed)
       VALUES ($1,$2,$3,$4,true)`,
      [req.auth!.id, input.intent, input.action, JSON.stringify(input.auditPayload)],
    );
    void result;
    res.status(200).json({
      success: true,
      data: { confirmed: true, intent: input.intent, action: input.action },
    });
  } catch (error) {
    next(error);
  }
});
