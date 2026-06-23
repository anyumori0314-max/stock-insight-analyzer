import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Phase 12–15 makes the SQLite history pipeline (`historical`/`hybrid` modes and
 * the CSV import / daily-update CLIs) a first-class operational feature. Those use
 * the built-in `node:sqlite` module, which requires Node >= 22.5, so the whole
 * repository pins the same minimum. This guard keeps the three manifests in sync
 * (a drift here is what the Codex review flagged).
 */
const REQUIRED_ENGINES_NODE = ">=22.5.0";

// tests/ -> backend/ -> repo root
const repoRoot = path.join(__dirname, "..", "..");

function enginesNode(relPath: string): string | undefined {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, relPath), "utf8")) as {
    engines?: { node?: string };
  };
  return pkg.engines?.node;
}

describe("package.json engines.node alignment", () => {
  it("root, backend and frontend all require Node >= 22.5", () => {
    expect(enginesNode("package.json")).toBe(REQUIRED_ENGINES_NODE);
    expect(enginesNode("backend/package.json")).toBe(REQUIRED_ENGINES_NODE);
    expect(enginesNode("frontend/package.json")).toBe(REQUIRED_ENGINES_NODE);
  });
});
