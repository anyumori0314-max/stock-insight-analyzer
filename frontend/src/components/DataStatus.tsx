import type { StockReport } from "../types/stock";

interface DataStatusProps {
  report: StockReport;
}

/**
 * Compact, text-first status line for the active report: data source
 * (live / mock) and cache state (hit / miss), plus the provider's last-refreshed
 * stamp. Every distinction is conveyed with WORDS and an `aria-label`, never
 * color alone, so it is clear to assistive tech and color-blind users (Phase 7
 * UI-state requirement: live / mock / cache-hit / cache-miss are distinguishable).
 */
export function DataStatus({ report }: DataStatusProps) {
  const sourceLabel = report.source === "mock" ? "モックデータ" : "ライブ";
  const cacheLabel = report.cache.hit ? "キャッシュ再利用" : "新規取得";
  return (
    <p
      className="data-status"
      aria-label={`データ状態：${sourceLabel}、${cacheLabel}、最終更新 ${report.lastRefreshed ?? "不明"}`}
    >
      <span className={`tag tag--source-${report.source}`}>{sourceLabel}</span>
      <span className="tag">{cacheLabel}</span>
      <span className="muted">
        最終更新 {report.lastRefreshed ?? "—"}（{report.timezone ?? "—"}）
      </span>
    </p>
  );
}
