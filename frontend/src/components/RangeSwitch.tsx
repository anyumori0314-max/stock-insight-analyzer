import { memo } from "react";

import { RANGE_OPTIONS, type StockRange } from "../lib/ranges";

interface RangeSwitchProps {
  value: StockRange;
  onChange: (range: StockRange) => void;
}

/**
 * Window (period) selector. Display labels (e.g. "3か月") are kept separate from
 * the API values (e.g. "3m") — `RANGE_OPTIONS` is the single source of both, so
 * the UI can never offer a window the backend does not support.
 *
 * Rendered as a `group` of toggle buttons using `aria-pressed` (not a tablist:
 * these buttons re-key the on-demand store rather than swap a single panel), so
 * the selected window is announced to assistive tech without color alone.
 */
export const RangeSwitch = memo(function RangeSwitch({ value, onChange }: RangeSwitchProps) {
  return (
    <div className="range-switch" role="group" aria-label="表示期間">
      {RANGE_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="range-switch__btn"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});
