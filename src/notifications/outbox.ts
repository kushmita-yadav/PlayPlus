import { pool } from "../database/pool.js";

export async function enqueueNotification(input: {
  recipientType: "member" | "staff" | "guest";
  recipientId?: string;
  channel: "email" | "sms" | "in_app";
  eventType: string;
  subject?: string;
  body: string;
  scheduledAt?: Date;
}): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO notification_outbox
       (recipient_type,recipient_id,channel,event_type,subject,body,scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.recipientType, input.recipientId ?? null, input.channel, input.eventType,
     input.subject ?? null, input.body, input.scheduledAt?.toISOString() ?? new Date().toISOString()],
  );
}
