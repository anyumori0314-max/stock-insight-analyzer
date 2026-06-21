import { useRef, type KeyboardEvent } from "react";

interface TickerTabsProps {
  tickers: string[];
  activeTicker: string | null;
  onSelect: (ticker: string) => void;
  /** id of the tabpanel these tabs control. */
  panelId: string;
}

/**
 * Accessible tab strip for choosing the focused ticker. Implements the WAI-ARIA
 * tabs pattern: a `tablist` of `tab`s with roving tabindex, arrow / Home / End
 * keyboard navigation, and `aria-selected` / `aria-controls`. Selection follows
 * focus. Removal is intentionally handled elsewhere (comparison table / preset
 * toggle) so each tab stays a single, valid control.
 */
export function TickerTabs({ tickers, activeTicker, onSelect, panelId }: TickerTabsProps) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = tickers.length;
    if (count === 0) return;

    let nextIndex = index;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + count) % count;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTicker = tickers[nextIndex];
    onSelect(nextTicker);
    tabRefs.current[nextTicker]?.focus();
  }

  return (
    <div role="tablist" aria-label="表示銘柄" className="tab-strip">
      {tickers.map((ticker, index) => {
        const selected = ticker === activeTicker;
        return (
          <button
            key={ticker}
            type="button"
            role="tab"
            id={`tab-${ticker}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              tabRefs.current[ticker] = el;
            }}
            className={`tab${selected ? " tab--active" : ""}`}
            onClick={() => onSelect(ticker)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {ticker}
          </button>
        );
      })}
    </div>
  );
}
