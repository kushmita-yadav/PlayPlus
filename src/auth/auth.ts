import bcrypt from "bcryptjs";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../database/pool.js";
import { ApiError } from "../middleware/errors.js";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

const secret = (): string => {
  if (!env.JWT_SECRET) throw new ApiError(503, "Authentication is not configured", "AUTH_UNCONFIGURED");
  return env.JWT_SECRET;
};

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["member", "front_desk", "staff", "manager", "admin"]).optional().default("member"),
});

export async function registerAccount(input: z.infer<typeof registerSchema>) {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");

  const existing = await pool.query("SELECT id FROM accounts WHERE lower(email) = lower($1)", [input.email]);
  if (existing.rowCount) throw new ApiError(409, "Email is already registered", "EMAIL_EXISTS");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await pool.query(
    `INSERT INTO accounts (email, password_hash, full_name, role_id)
     SELECT $1, $2, $3, r.id FROM roles r WHERE r.name = $4
     RETURNING id, email, full_name`,
    [input.email.toLowerCase(), passwordHash, input.fullName, input.role],
  );
  if (!result.rowCount) throw new ApiError(500, "Account role could not be assigned", "ROLE_MISSING");
  const account = result.rows[0];
  return { id: account.id, email: account.email, fullName: account.full_name, role: input.role };
}

export async function authenticate(email: string, password: string): Promise<AuthUser> {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  const result = await pool.query(
    `SELECT a.id, a.email, a.full_name, a.password_hash, a.status,
            a.failed_login_attempts, a.locked_until, r.name AS role,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
     FROM accounts a
     JOIN roles r ON r.id = a.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE lower(a.email) = lower($1)
     GROUP BY a.id, r.name`,
    [email],
  );
  const account = result.rows[0];
  if (!account) throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  if (account.status !== "active") throw new ApiError(403, "Account is inactive", "ACCOUNT_INACTIVE");
  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    throw new ApiError(423, "Account is temporarily locked", "ACCOUNT_LOCKED");
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    const attempts = Number(account.failed_login_attempts) + 1;
    if (attempts >= 5) {
      await pool.query(
        "UPDATE accounts SET failed_login_attempts=$2, locked_until=now()+interval '15 minutes' WHERE id=$1",
        [account.id, attempts],
      );
      throw new ApiError(423, "Account locked after repeated failed login attempts", "ACCOUNT_LOCKED");
    }
    await pool.query("UPDATE accounts SET failed_login_attempts=$2 WHERE id=$1", [account.id, attempts]);
    throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }
  await pool.query("UPDATE accounts SET failed_login_attempts=0, locked_until=NULL, updated_at=now() WHERE id=$1", [account.id]);

  return {
    id: account.id,
    email: account.email,
    fullName: account.full_name,
    role: account.role,
    permissions: account.permissions,
  };
}

export function signToken(user: AuthUser): string {
  const options: SignOptions = { expiresIn: "8h", issuer: "playpulse", audience: "playpulse-api" };
  return jwt.sign({
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    permissions: user.permissions,
  }, secret(), options);
}

export function hashSecurityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string): Promise<string> {
  if (!pool) throw new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE");
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO refresh_tokens (account_id, token_hash, expires_at)
     VALUES ($1,$2,now()+interval '30 days')`,
    [userId, hashSecurityToken(token)],
  );
  return token;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    next(new ApiError(401, "Bearer authentication required", "UNAUTHORIZED"));
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), secret(), {
      issuer: "playpulse",
      audience: "playpulse-api",
    }) as JwtPayload & { role: string; permissions: string[]; email: string; fullName?: string };
    if (!payload.sub) throw new Error("Missing subject");
    req.auth = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.fullName ?? "",
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired token", "INVALID_TOKEN"));
  }
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new ApiError(401, "Bearer authentication required", "UNAUTHORIZED"));
    } else if (req.auth.role !== "admin" && !req.auth.permissions.includes(permission)) {
      next(new ApiError(403, "Permission denied", "FORBIDDEN"));
    } else {
      next();
    }
  };
}

const roleHierarchy: Record<string, number> = {
  visitor: 0,
  member: 10,
  front_desk: 20,
  staff: 30,
  manager: 40,
  admin: 50,
};

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new ApiError(401, "Bearer authentication required", "UNAUTHORIZED"));
    } else if (!roles.includes(req.auth.role)) {
      next(new ApiError(403, "This role is not permitted", "FORBIDDEN"));
    } else {
      next();
    }
  };
}

export function requireRoleAtLeast(minimumRole: string) {
  const minimum = roleHierarchy[minimumRole] ?? Number.MAX_SAFE_INTEGER;
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new ApiError(401, "Bearer authentication required", "UNAUTHORIZED"));
    } else if ((roleHierarchy[req.auth.role] ?? -1) < minimum) {
      next(new ApiError(403, "Insufficient role level", "FORBIDDEN"));
    } else {
      next();
    }
  };
}

export function requireMemberOrPermission(permission: string) {
  const permissionGuard = requirePermission(permission);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.auth?.role === "member") {
      next();
    } else {
      permissionGuard(req, res, next);
    }
  };
}

export function createUiSession(role: string, name: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({
    role,
    name,
    email,
    exp: Date.now() + 8 * 60 * 60 * 1000,
  })).toString("base64url");
  const signature = createHash("sha256")
    .update(`${payload}.${env.JWT_SECRET ?? "playpulse-local-ui-secret"}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function readUiSession(cookieValue: string | undefined): {
  role: string;
  name: string;
  email: string;
  exp: number;
} | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [payload, suppliedSignature] = parts;
  const expectedSignature = createHash("sha256")
    .update(`${payload}.${env.JWT_SECRET ?? "playpulse-local-ui-secret"}`)
    .digest("base64url");
  if (suppliedSignature !== expectedSignature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (typeof parsed.role !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
