import type { DataStatus as DataStatusMeta, StockReport } from "../types/stock";

interface DataStatusProps {
  report: StockReport;
}

/** Japanese label for the report's data-serving mode. */
const SOURCE_LABEL: Record<StockReport["source"], string> = {
  live: "ライブ",
  mock: "モックデータ",
  historical: "ローカル履歴データ",
  hybrid: "API補完済み",
};

/** Japanese label for the immediate origin of the freshest bars. */
const DATA_SOURCE_LABEL: Record<DataStatusMeta["dataSource"], string> = {
  mock: "開発用モックデータ",
  sqlite: "ローカル履歴データ",
  csv: "CSV取込データ",
  api: "API補完済み",
};

/** Formats an ISO date / datetime for display without leaking a timezone guess. */
function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}

/**
 * Text-first data-status panel for the active report. Every distinction is
 * conveyed with WORDS (and an `aria-label`), never color alone, so it is clear to
 * assistive tech and color-blind users.
 *
 * Backwards compatible: for a Phase 2–11 report WITHOUT `dataStatus` (mock/live)
 * it renders exactly the original source / cache / last-refreshed line. When the
 * richer `dataStatus` metadata is present (historical/hybrid) it additionally
 * shows the data origin, latest trade date, record count, update timestamps, and
 * — via a polite `status` / assertive `alert` region — any stale / fallback state.
 */
export function DataStatus({ report }: DataStatusProps) {
  const sourceLabel = SOURCE_LABEL[report.source] ?? report.source;
  const cacheLabel = report.cache.hit ? "キャッシュ再利用" : "新規取得";
  const ds = report.dataStatus;

  return (
    <div className="data-status-block">
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

      {ds && (
        <>
          <dl className="data-status-detail">
            <div>
              <dt>取得元</dt>
              <dd>{DATA_SOURCE_LABEL[ds.dataSource]}</dd>
            </div>
            <div>
              <dt>最新取引日</dt>
              <dd>{ds.latestTradeDate ?? "—"}</dd>
            </div>
            <div>
              <dt>データ件数</dt>
              <dd>{ds.recordCount}件</dd>
            </div>
            <div>
              <dt>最終更新日時</dt>
              <dd>{formatInstant(ds.lastUpdatedAt)}</dd>
            </div>
            {ds.csvImportedAt && (
              <div>
                <dt>CSV取込</dt>
                <dd>{formatInstant(ds.csvImportedAt)}</dd>
              </div>
            )}
            {ds.apiSyncedAt && (
              <div>
                <dt>API同期</dt>
                <dd>{formatInstant(ds.apiSyncedAt)}</dd>
              </div>
            )}
            {ds.persistent && (
              <div>
                <dt>保存先</dt>
                <dd>ローカルDB（SQLite）</dd>
              </div>
            )}
          </dl>

          {ds.fallbackUsed && (
            <p className="data-status-alert" role="alert">
              ⚠ API取得に失敗したため、保存済みデータを表示しています。
            </p>
          )}
          {ds.stale && !ds.fallbackUsed && (
            <p className="data-status-note" role="status" aria-live="polite">
              ⏱ 最終更新から時間が経過しています。最新データを確認できませんでした。
            </p>
          )}
        </>
      )}
    </div>
  );
}
