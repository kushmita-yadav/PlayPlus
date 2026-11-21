import type { Server } from "node:http";
import { createApp, closeDatabase } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";

const app = createApp();
const server: Server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "PlayPulse API listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  server.close(async (error) => {
    if (error) logger.error({ err: error }, "HTTP server close failed");
    await closeDatabase();
    logger.info("Graceful shutdown complete");
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app, server };
