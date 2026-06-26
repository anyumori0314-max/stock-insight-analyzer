import { memo, useEffect, useRef, useState, type ChangeEvent } from "react";

/**
 * Reads a File as UTF-8 text. Prefers the modern `Blob.text()` (real browsers),
 * falling back to `FileReader` for environments that lack it (e.g. jsdom under
 * test), so import works everywhere without a polyfill.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsText(file);
  });
}

interface WatchlistPanelProps {
  /** Ordered watchlist symbols (the persisted display order). */
  watchlist: string[];
  /** Symbols that belong to the built-in FANG+ preset (for the origin tag). */
  presets: Set<string>;
  activeTicker: string | null;
  /** Visually-hidden polite announcement (save / import / reset outcomes). */
  statusMessage: string;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onMove: (ticker: string, direction: "up" | "down") => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (jsonText: string) => void;
}

/**
 * Watchlist manager (Phase 17): shows the persisted, ordered watchlist and lets
 * the user reorder, remove, reset, and import/export it.
 *
 * ACCESSIBILITY:
 *  - Reordering is plain move-up / move-down buttons, so it is fully keyboard
 *    operable (no drag-and-drop trap). After a move, focus follows the moved row
 *    so repeated keyboard moves keep working without hunting for focus.
 *  - A single polite live region announces save failures and import/reset
 *    outcomes, so assistive-tech users hear the result.
 *  - "Reset all" is a two-step inline confirm (not a destructive single click),
 *    so the whole list is never wiped by an accidental activation.
 */
export const WatchlistPanel = memo(function WatchlistPanel({
  watchlist,
  presets,
  activeTicker,
  statusMessage,
  onSelect,
  onRemove,
  onMove,
  onReset,
  onExport,
  onImport,
}: WatchlistPanelProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // After a reorder the list re-renders; restore focus to the moved row's control.
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    pendingFocusId.current = null;
    const el = document.getElementById(id);
    if (el && !(el as HTMLButtonElement).disabled) {
      el.focus();
    } else {
      document.getElementById(`wl-select-${id.split("-").slice(2).join("-")}`)?.focus();
    }
  });

  function handleMove(ticker: string, direction: "up" | "down") {
    // Prefer keeping focus on the same direction button; the effect falls back to
    // the row's select button if that button is now disabled (at a boundary).
    pendingFocusId.current = `wl-move-${direction}-${ticker}`;
    onMove(ticker, direction);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so selecting the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    try {
      onImport(await readFileText(file));
    } catch {
      onImport("");
    }
  }

  return (
    <section className="panel" aria-labelledby="watchlist-title">
      <h2 className="panel__title" id="watchlist-title">
        ウォッチリスト
      </h2>

      {/* Polite, visually-hidden announcements (save failure, import/reset). */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </div>

      {watchlist.length === 0 ? (
        <p className="panel__note">
          プリセットを選ぶか、ティッカーを追加するとここに表示され、次回以降も保持されます。
        </p>
      ) : (
        <ul className="watchlist" aria-label="保存された銘柄">
          {watchlist.map((ticker, index) => {
            const isActive = ticker === activeTicker;
            const origin = presets.has(ticker) ? "プリセット" : "個別追加";
            return (
              <li key={ticker} className={`watchlist__item${isActive ? " watchlist__item--active" : ""}`}>
                <button
                  type="button"
                  id={`wl-select-${ticker}`}
                  className="watchlist__select"
                  aria-pressed={isActive}
                  onClick={() => onSelect(ticker)}
                >
                  <span className="watchlist__symbol">{ticker}</span>
                  <span className="watchlist__origin">{origin}</span>
                </button>
                <div className="watchlist__controls">
                  <button
                    type="button"
                    id={`wl-move-up-${ticker}`}
                    className="icon-btn"
                    onClick={() => handleMove(ticker, "up")}
                    disabled={index === 0}
                    aria-label={`${ticker} を上へ移動`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    id={`wl-move-down-${ticker}`}
                    className="icon-btn"
                    onClick={() => handleMove(ticker, "down")}
                    disabled={index === watchlist.length - 1}
                    aria-label={`${ticker} を下へ移動`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    onClick={() => onRemove(ticker)}
                    aria-label={`${ticker} をウォッチリストから削除`}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="watchlist__actions">
        <button type="button" className="btn btn--ghost" onClick={onExport} disabled={watchlist.length === 0}>
          エクスポート
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => fileInputRef.current?.click()}
        >
          インポート
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="ウォッチリストJSONをインポート"
          onChange={handleFileChange}
        />
      </div>

      {watchlist.length > 0 &&
        (confirmingReset ? (
          <div className="watchlist__confirm" role="group" aria-label="初期化の確認">
            <span className="panel__note">すべて削除しますか？</span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setConfirmingReset(false);
                onReset();
              }}
            >
              削除する
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmingReset(false)}>
              キャンセル
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setConfirmingReset(true)}>
            すべて初期化
          </button>
        ))}
    </section>
  );
});
