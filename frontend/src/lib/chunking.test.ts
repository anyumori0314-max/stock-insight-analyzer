import { describe, expect, it } from "vitest";

/**
 * Design-level guard for Phase 8 code-splitting: Recharts (the heaviest
 * dependency) must stay OUT of the initial bundle and load only when a chart
 * first renders.
 *
 * This asserts the SOURCE invariants that guarantee it — fast and offline, with
 * no build step. The build-output checks (no Recharts `modulepreload` in
 * index.html, no static import edge from the entry chunk) are verified manually
 * after `vite build`; see the deployment notes.
 */

// Load every source file as raw text (Vite feature; no node:fs needed).
const allSources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** App sources excluding test files. */
const sources = Object.fromEntries(
  Object.entries(allSources).filter(([p]) => !/\.test\.(ts|tsx)$/.test(p))
);

describe("Recharts is loaded lazily (kept out of the initial bundle)", () => {
  it("is imported by PriceChart.tsx ONLY (no other module pulls it into the graph)", () => {
    const importers = Object.entries(sources)
      .filter(([, content]) => /from\s+["']recharts["']/.test(content))
      .map(([p]) => p.split("/").pop())
      .sort();
    expect(importers).toEqual(["PriceChart.tsx"]);
  });

  it("App loads PriceChart via React.lazy(() => import(...)) and never imports it statically", () => {
    const app = sources["/src/App.tsx"];
    expect(app).toBeDefined();
    expect(app).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/components\/PriceChart["']/);
    // No static import of PriceChart, and Recharts itself is never imported here.
    expect(app).not.toMatch(/import\s+[^;]*from\s+["']\.\/components\/PriceChart["']/);
    expect(app).not.toMatch(/from\s+["']recharts["']/);
  });
});
