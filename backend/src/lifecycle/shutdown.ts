import type { Logger } from "../utils/logger";

/** The slice of `http.Server` the shutdown controller needs (testable). */
export interface HttpServerLike {
  close(callback: (err?: Error) => void): void;
}

export interface ShutdownOptions {
  server: HttpServerLike;
  logger: Logger;
  /** Force-exit budget (ms) if connections do not drain in time. Default 10s. */
  timeoutMs?: number;
  /** Injectable process exit (tests). Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Injectable timer (tests / fake timers). Defaults to global setTimeout. */
  setTimeoutFn?: typeof setTimeout;
  /** Injectable timer clear (tests). Defaults to global clearTimeout. */
  clearTimeoutFn?: typeof clearTimeout;
}

export interface ShutdownController {
  /** Begins a graceful shutdown for the given signal. Idempotent. */
  shutdown(signal: string): void;
  /** True once a shutdown has started. */
  readonly active: boolean;
}

/**
 * Graceful shutdown controller (Phase 10).
 *
 * On the first SIGINT/SIGTERM it stops accepting new connections (`server.close`)
 * and exits 0 once in-flight requests drain. A second signal while already
 * shutting down is logged once and ignored (no double close). If draining
 * exceeds `timeoutMs`, it force-exits with code 1. All logging goes through the
 * structured logger and contains only the signal name — never secrets.
 */
export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const setTimer = options.setTimeoutFn ?? setTimeout;
  const clearTimer = options.clearTimeoutFn ?? clearTimeout;
  const { server, logger } = options;

  let active = false;

  return {
    get active() {
      return active;
    },
    shutdown(signal: string) {
      if (active) {
        // A second signal during shutdown must not trigger another close().
        logger.warn("server.shutdown.ignored", { signal });
        return;
      }
      active = true;
      logger.info("server.shutdown.begin", { signal });

      const timer = setTimer(() => {
        logger.error("server.shutdown.forced", { signal, timeoutMs });
        exit(1);
      }, timeoutMs);
      // Do not keep the event loop alive solely for this timer.
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
      }

      server.close((err) => {
        clearTimer(timer);
        if (err) {
          logger.error("server.shutdown.error", { signal });
          exit(1);
          return;
        }
        logger.info("server.shutdown.complete", { signal });
        exit(0);
      });
    },
  };
}
