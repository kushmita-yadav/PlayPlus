import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "../middleware/errors.js";

const orderResponseSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
});

const paymentResponseSchema = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  status: z.string(),
});

function razorpayAuthorization() {
  if (env.PAYMENT_PROVIDER !== "razorpay" || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(503, "Online payments are not configured", "PAYMENT_PROVIDER_UNAVAILABLE");
  }
  return {
    keyId: env.RAZORPAY_KEY_ID,
    authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
  };
}

async function providerRequest<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ApiError(502, "Payment provider is temporarily unavailable", "PAYMENT_PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new ApiError(502, "Payment provider request failed", "PAYMENT_PROVIDER_ERROR");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(502, "Payment provider returned an invalid response", "PAYMENT_PROVIDER_INVALID_RESPONSE");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(502, "Payment provider returned an invalid response", "PAYMENT_PROVIDER_INVALID_RESPONSE");
  }
  return parsed.data;
}

export async function createRazorpayOrder(amountPaise: number, receipt: string) {
  const { keyId, authorization } = razorpayAuthorization();
  const order = await providerRequest(
    "https://api.razorpay.com/v1/orders",
    {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }),
    },
    orderResponseSchema,
  );
  if (order.amount !== amountPaise || order.currency !== "INR") {
    throw new ApiError(502, "Payment provider returned a mismatched order amount", "PAYMENT_PROVIDER_AMOUNT_MISMATCH");
  }
  return { orderId: order.id, keyId };
}

export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret = env.RAZORPAY_KEY_SECRET,
) {
  if (!secret) throw new ApiError(503, "Online payments are not configured", "PAYMENT_PROVIDER_UNAVAILABLE");
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function getRazorpayPayment(paymentId: string) {
  const { authorization } = razorpayAuthorization();
  return providerRequest(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: authorization } },
    paymentResponseSchema,
  );
}
