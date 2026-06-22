import { describe, expect, it, vi } from "vitest";

import { createShutdownController } from "../src/lifecycle/shutdown";
import { silentLogger } from "../src/utils/logger";

/** A fake http.Server whose `close` completion is driven manually. */
function fakeServer() {
  let closeCb: ((err?: Error) => void) | null = null;
  const close = vi.fn((cb: (err?: Error) => void) => {
    closeCb = cb;
  });
  return { close, finishClose: (err?: Error) => closeCb?.(err) };
}

describe("createShutdownController", () => {
  it("closes the server once and exits 0 on a clean drain", () => {
    const server = fakeServer();
    const exit = vi.fn();
    const controller = createShutdownController({ server, logger: silentLogger, exit });

    controller.shutdown("SIGTERM");
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(controller.active).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    server.finishClose();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("ignores a second signal — no double close()", () => {
    const server = fakeServer();
    const exit = vi.fn();
    const controller = createShutdownController({ server, logger: silentLogger, exit });

    controller.shutdown("SIGINT");
    controller.shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("force-exits with code 1 when draining exceeds the timeout", () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer(); // never finishes closing
      const exit = vi.fn();
      createShutdownController({ server, logger: silentLogger, exit, timeoutMs: 5_000 }).shutdown(
        "SIGTERM"
      );

      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5_000);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits 1 when server.close reports an error", () => {
    const server = fakeServer();
    const exit = vi.fn();
    createShutdownController({ server, logger: silentLogger, exit }).shutdown("SIGTERM");

    server.finishClose(new Error("close failed"));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
