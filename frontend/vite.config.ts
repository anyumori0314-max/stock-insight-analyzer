import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * In development the API runs on a separate port (default 3001). Proxying
 * `/api` keeps the browser talking to a single origin (the Vite dev server),
 * so requests are same-origin and no CORS round-trips are needed locally.
 *
 * The backend port can be overridden with `VITE_API_PROXY_TARGET`.
 */
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
