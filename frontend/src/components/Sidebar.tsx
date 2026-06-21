import { useState, type FormEvent } from "react";

import { FANG_PLUS_PRESET_NOTE, FANG_PLUS_PRESETS, validateTicker } from "../lib/tickers";

interface SidebarProps {
  selected: string[];
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

export function Sidebar({ selected, onAdd, onRemove }: SidebarProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const selectedSet = new Set(selected);

  function togglePreset(symbol: string) {
    if (selectedSet.has(symbol)) {
      onRemove(symbol);
    } else {
      onAdd(symbol);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateTicker(input);
    if (!result.ok || !result.value) {
      setError(result.error ?? "入力が正しくありません。");
      return;
    }
    if (selectedSet.has(result.value)) {
      setError("すでに追加されています。");
      return;
    }
    onAdd(result.value);
    setInput("");
    setError("");
  }

  return (
    <aside className="sidebar">
      <section className="panel" aria-labelledby="preset-title">
        <h2 className="panel__title" id="preset-title">
          FANG+ 参考プリセット
        </h2>
        <p className="panel__note">{FANG_PLUS_PRESET_NOTE}</p>
        <div className="preset-grid">
          {FANG_PLUS_PRESETS.map((preset) => (
            <button
              key={preset.symbol}
              type="button"
              className="preset-chip"
              aria-pressed={selectedSet.has(preset.symbol)}
              onClick={() => togglePreset(preset.symbol)}
            >
              <span className="preset-chip__symbol">{preset.symbol}</span>
              <span className="preset-chip__name">{preset.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="ticker-title">
        <h2 className="panel__title" id="ticker-title">
          個別銘柄を追加
        </h2>
        <form className="ticker-form" onSubmit={handleSubmit} noValidate>
          <div className="ticker-form__row">
            <input
              className="text-input"
              type="text"
              value={input}
              placeholder="例: BRK.B"
              aria-label="ティッカーシンボル"
              aria-invalid={error !== ""}
              maxLength={10}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setInput(event.target.value);
                if (error) setError("");
              }}
            />
            <button className="btn" type="submit">
              追加
            </button>
          </div>
          <p className="field-error" role="alert">
            {error}
          </p>
        </form>
      </section>
    </aside>
  );
}
