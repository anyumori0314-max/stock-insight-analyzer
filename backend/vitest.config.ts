import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Ensures the app builds in test mode (clean error bodies, no dev details).
    env: {
      NODE_ENV: "test",
    },
  },
});
