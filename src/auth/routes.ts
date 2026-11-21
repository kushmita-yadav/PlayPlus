import type { Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { pool } from "../database/pool.js";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/errors.js";
import {
  authenticate,
  hashSecurityToken,
  issueRefreshToken,
  registerAccount,
  registerSchema,
  requireAuth,
  signToken,
  createUiSession,
  readUiSession,
} from "./auth.js";

export const authRouter: Router = createRouter();

authRouter.post("/register", async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    if (input.role !== "member") {
      throw new ApiError(403, "Only member accounts may self-register", "SELF_ROLE_ASSIGNMENT_DENIED");
    }
    const account = await registerAccount(input);
    res.status(201).json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/demo-login", async (req, res, next) => {
  try {
    const input = z.object({
      email: z.string().email(),
      password: z.string().min(1),
      role: z.enum(["admin", "member", "visitor"]),
    }).parse(req.body);
    const accounts = {
      admin: { email: "admin@champions.club", password: "Admin@123", name: "Alex Kumar" },
      member: { email: "member@champions.club", password: "Member@123", name: "Aarav Mehta" },
      visitor: { email: "visitor@champions.club", password: "Visitor@123", name: "Visitor" },
    };
    if (input.role === "visitor") {
      const session = createUiSession("visitor", "Visitor", "visitor@champions.club");
      res.setHeader("Set-Cookie", `playpulse_ui=${session}; Path=/; HttpOnly; SameSite=Lax${env.NODE_ENV === "production" ? "; Secure" : ""}`);
      res.status(200).json({ success: true, data: { role: "visitor", name: "Visitor" } });
      return;
    }
    const account = accounts[input.role];
    if (input.email.toLowerCase() !== account.email || input.password !== account.password) {
      throw new ApiError(401, "Invalid demo credentials", "INVALID_DEMO_CREDENTIALS");
    }
    const session = createUiSession(input.role, account.name, account.email);
    res.setHeader("Set-Cookie", `playpulse_ui=${session}; Path=/; HttpOnly; SameSite=Lax${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    res.status(200).json({
      success: true,
      data: { role: input.role, name: account.name, email: account.email },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/demo-logout", (_req, res) => {
  res.setHeader("Set-Cookie", "playpulse_ui=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.status(200).json({ success: true, data: { signedOut: true } });
});

authRouter.get("/demo-session", (req, res) => {
  const cookie = req.headers.cookie?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("playpulse_ui="))
    ?.slice("playpulse_ui=".length);
  const session = readUiSession(cookie);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    success: true,
    data: session ? {
      role: session.role,
      name: session.name,
      email: session.email,
    } : null,
  });
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(128),
    }).parse(req.body);
    const user = await authenticate(input.email, input.password);
    const refreshToken = await issueRefreshToken(user.id);
    res.status(200).json({
      success: true,
      data: { accessToken: signToken(user), refreshToken, expiresIn: "8h", user },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ success: true, data: req.auth });
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({ refreshToken: z.string().min(32).max(128) }).parse(req.body);
    const hash = hashSecurityToken(input.refreshToken);
    const found = await pool.query(
      `SELECT rt.account_id, a.email, r.name AS role,
              COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM refresh_tokens rt
       JOIN accounts a ON a.id=rt.account_id
       JOIN roles r ON r.id=a.role_id
       LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at > now()
       GROUP BY rt.account_id, a.email, r.name`,
      [hash],
    );
    if (!found.rowCount) throw new ApiError(401, "Invalid or expired refresh token", "INVALID_REFRESH_TOKEN");
    await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1", [hash]);
    const row = found.rows[0];
    const user = {
      id: row.account_id,
      email: row.email,
      fullName: "",
      role: row.role,
      permissions: row.permissions,
    };
    const refreshToken = await issueRefreshToken(user.id);
    res.status(200).json({
      success: true,
      data: { accessToken: signToken(user), refreshToken, expiresIn: "8h" },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password-reset/request", async (req, res, next) => {
  try {
    if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({ email: z.string().email() }).parse(req.body);
    const account = await pool.query("SELECT id FROM accounts WHERE lower(email)=lower($1)", [input.email]);
    if (account.rowCount) {
      const token = randomBytes(32).toString("hex");
      await pool.query(
        `INSERT INTO password_reset_tokens (account_id, token_hash, expires_at)
         VALUES ($1,$2,now()+interval '1 hour')`,
        [account.rows[0].id, hashSecurityToken(token)],
      );
      // Delivery is external. The token is never returned to the public API.
      // Integration should send this token through email/SMS before it expires.
      void token;
    }
    res.status(202).json({
      success: true,
      data: { message: "If the account exists, reset instructions will be sent" },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password-reset/confirm", async (req, res, next) => {
  try {
    if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
    const input = z.object({
      resetToken: z.string().min(32).max(128),
      password: z.string().min(12).max(128),
    }).parse(req.body);
    const hash = hashSecurityToken(input.resetToken);
    const token = await pool.query(
      `SELECT id, account_id FROM password_reset_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`,
      [hash],
    );
    if (!token.rowCount) throw new ApiError(400, "Reset token is invalid or expired", "INVALID_RESET_TOKEN");
    const passwordHash = await bcrypt.hash(input.password, 12);
    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE accounts
         SET password_hash=$2, failed_login_attempts=0, locked_until=NULL,
             password_changed_at=now(), updated_at=now()
         WHERE id=$1`,
        [token.rows[0].account_id, passwordHash],
      );
      await pool.query("UPDATE password_reset_tokens SET used_at=now() WHERE id=$1", [token.rows[0].id]);
      await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",
        [token.rows[0].account_id]);
      await pool.query("COMMIT");
      res.status(200).json({ success: true, data: { passwordReset: true } });
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    next(error);
  }
});
