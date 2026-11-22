import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  PAYMENT_PROVIDER: z.enum(["manual", "razorpay"]).default("manual"),
  RAZORPAY_KEY_ID: z.string().trim().optional().transform((value) => value || undefined),
  RAZORPAY_KEY_SECRET: z.string().trim().optional().transform((value) => value || undefined),
  GROQ_API_KEY: z.string().trim().optional().transform((value) => value || undefined),
  GROQ_MODEL: z.string().trim().min(1).default("openai/gpt-oss-20b"),
  CLUB_TIMEZONE: z.string().default("Asia/Kolkata"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true"),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;
  if (!value.DATABASE_URL) {
    context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "is required in production" });
  }
  if (!value.JWT_SECRET) {
    context.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "is required in production" });
  }
  if (value.DATABASE_SSL !== "true") {
    context.addIssue({ code: "custom", path: ["DATABASE_SSL"], message: "must be enabled in production" });
  }
  if (value.PAYMENT_PROVIDER === "razorpay" && (!value.RAZORPAY_KEY_ID || !value.RAZORPAY_KEY_SECRET)) {
    context.addIssue({
      code: "custom",
      path: ["RAZORPAY_KEY_ID"],
      message: "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay",
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env = parsed.data;
