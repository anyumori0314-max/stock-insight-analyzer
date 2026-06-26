#!/usr/bin/env bash
#
# Forbidden-file gate.
#
# Fails if git is TRACKING any artifact that must never be committed: secrets,
# real databases / SQLite sidecars, caches, build output, coverage, logs, real
# CSV market data, per-developer Claude settings, or a hard-coded local absolute
# path inside tracked source/config.
#
# Design notes:
#   * Only the git INDEX is inspected (`git ls-files`), never the working tree,
#     so untracked local scratch files (a real .env, a local *.sqlite, a .cache/
#     dir, fixture exports) are correctly ignored — only what would actually be
#     committed is gated.
#   * Documentation (*.md) is intentionally NOT scanned for absolute paths, so a
#     Windows path shown as an EXAMPLE in the README / docs is never flagged.
#   * `.env.example` (the documented template) and `*.example.csv` (synthetic
#     fixtures) are explicitly allowed; real `.env*` / `*.csv` are not.
#   * The absolute-path check prints only FILE NAMES (`git grep -l`), never the
#     matched line, so a secret that happens to share a line can never be echoed.
#
# Used by CI (the forbidden-file gate) and runnable locally:
#   bash scripts/check-forbidden-files.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# Reports a category of forbidden files. $1 = label, $2 = newline-separated paths.
report() {
  echo "ERROR: forbidden tracked file(s) [$1]:"
  printf '%s\n' "$2" | sed 's/^/  /'
  fail=1
}

# Snapshot of everything git is tracking. `|| true` guards the (impossible-here)
# empty-repo case so `set -e` does not abort on a non-fatal grep "no match".
tracked="$(git ls-files || true)"
match() { printf '%s\n' "$tracked" | grep -E "$1" || true; }

# 1. .env and dotenv variants (but .env.example is the documented template).
hits="$(match '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' || true)"
if [ -n "$hits" ]; then report ".env / secrets" "$hits"; fi

# 2. Databases and SQLite WAL/SHM/journal sidecars (any name / location).
hits="$(match '\.(sqlite|sqlite3|db)$|-(wal|shm)$|-journal$')"
if [ -n "$hits" ]; then report "database / sqlite sidecars" "$hits"; fi

# 3. Caches and build output.
hits="$(match '(^|/)\.cache/|(^|/)dist/|(^|/)build/|(^|/)coverage/')"
if [ -n "$hits" ]; then report "cache / build output / coverage" "$hits"; fi

# 4. Logs.
hits="$(match '\.log$')"
if [ -n "$hits" ]; then report "log files" "$hits"; fi

# 5. Real CSV market data (a synthetic *.example.csv template is allowed; test
#    fixtures live INLINE in tests, not as tracked .csv files).
hits="$(match '\.csv$' | grep -vE '\.example\.csv$' || true)"
if [ -n "$hits" ]; then report "CSV data" "$hits"; fi

# 6. Per-developer Claude settings.
hits="$(match 'settings\.local\.json$')"
if [ -n "$hits" ]; then report "local Claude settings" "$hits"; fi

# 7. Hard-coded local absolute paths inside tracked source/config (NOT docs).
#    `/home/<user>/` requires a trailing slash so a URL path like `/home/page`
#    is not matched. File names only — never the matched line (no secret echo).
abs_files="$(git grep -lI -e 'C:\\Users\\' -e '/home/[a-z][a-z0-9_.-]*/' -- \
  '*.ts' '*.tsx' '*.js' '*.cjs' '*.mjs' '*.json' '*.yml' '*.yaml' || true)"
if [ -n "$abs_files" ]; then
  report "hard-coded local absolute path in source" "$abs_files"
fi

if [ "$fail" -ne 0 ]; then
  echo "Forbidden-file check FAILED."
  exit 1
fi
echo "Forbidden-file check passed: no secrets or build artifacts are tracked."
