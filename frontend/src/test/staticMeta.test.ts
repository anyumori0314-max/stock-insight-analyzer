import { describe, expect, it } from "vitest";

// Vite's `?raw` loader inlines the file contents as a string at transform time,
// so these run in the jsdom environment without Node fs types.
import html from "../../index.html?raw";
import favicon from "../../public/favicon.svg?raw";
import robots from "../../public/robots.txt?raw";

/**
 * Guards the static public-release metadata that lives outside the React tree:
 * the document head (favicon + description) and the `public/` assets Vite copies
 * to the site root. These are easy to drop in a refactor, so we assert them
 * directly from the source files rather than through the rendered app.
 */
describe("static metadata (index.html head)", () => {
  it("references the SVG favicon so the browser does not 404 on /favicon.ico", () => {
    expect(html).toMatch(/<link\s+rel="icon"[^>]*href="\/favicon\.svg"/);
  });

  it("declares a Japanese meta description that matches the app", () => {
    expect(html).toMatch(/<meta\s+name="description"/);
    expect(html).toContain("株価分析ツール");
  });
});

describe("static metadata (public/ assets)", () => {
  it("ships an SVG favicon asset", () => {
    expect(favicon).toContain("<svg");
  });

  it("ships a robots.txt that allows crawling the whole site", () => {
    expect(robots).toMatch(/User-agent:\s*\*/);
    expect(robots).toMatch(/Allow:\s*\//);
  });
});
