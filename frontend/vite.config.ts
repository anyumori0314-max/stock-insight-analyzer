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
  build: {
    // Recharts (the heaviest dependency, ~110 kB gzip) is imported ONLY by
    // `PriceChart`, which `App` pulls in via `React.lazy`. We deliberately do NOT
    // declare a manual vendor chunk for it: an object-form `manualChunks` entry
    // marks that chunk as part of the INITIAL graph, so Vite emitted a
    // `<link rel="modulepreload">` for Recharts in index.html — fetching it on
    // first paint even though no chart is shown yet. By leaving chunking to
    // Vite's automatic dynamic-import splitting, Recharts lands in the async
    // chunk reachable only from the lazy `PriceChart` import: NO static edge from
    // the entry chunk and NO modulepreload in index.html, so it is fetched only
    // when a chart first renders. React/react-dom/zod/app code stay in the entry
    // chunk (all needed for first paint).
    rollupOptions: {},
  },
});
