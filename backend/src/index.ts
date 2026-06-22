import path from "path";
import dotenv from "dotenv";

import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createShutdownController } from "./lifecycle/shutdown";
import { createLogger } from "./utils/logger";

// Load the single root .env regardless of the current working directory or
// whether we run from src (tsx) or dist (node).
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const env = loadEnv();

// Verbose in development, lean in production. The logger never prints secrets.
const logger = createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
});

const app = createApp({ env, logger });

const server = app.listen(env.PORT, () => {
  // Never log secrets — only safe, operational facts.
  logger.info("server.start", {
    port: env.PORT,
    env: env.NODE_ENV,
    dataMode: env.STOCK_DATA_MODE,
  });
});

// Graceful shutdown: drain in-flight requests on SIGINT/SIGTERM, force-exit if
// draining stalls, and ignore a duplicate signal.
const controller = createShutdownController({ server, logger });
process.on("SIGINT", () => controller.shutdown("SIGINT"));
process.on("SIGTERM", () => controller.shutdown("SIGTERM"));
