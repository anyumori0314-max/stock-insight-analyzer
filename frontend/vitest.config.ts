import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Frontend test runner config. Component/hook tests run in jsdom and NEVER hit
 * the network — `fetch` is mocked per test. There is no real-API smoke test in
 * this suite by design.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
