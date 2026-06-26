/**
 * Builds the multi-ticker comparison CSV (Phase 20). Pure and side-effect-free
 * (the DOM download lives in `csv.ts`), so it is unit-tested directly.
 *
 * Every numeric cell is a raw rounded number (not locale-formatted), so the file
 * is clean for spreadsheets; `toCsv` applies RFC-4180 quoting AND CSV
 * formula-injection neutralization to every field, including the ticker symbol.
 *
 * It includes a "指数(100基準)" column — each ticker's period performance indexed
 * to a common 100 baseline (100 + periodReturn%) — so multiple symbols can be
 * compared on equal footing regardless of absolute price.
 */

import type { ReportState } from "../hooks/useStockReports";
import { rangeLabel, type StockRange } from "./ranges";
import type { TrendVerdict } from "../types/stock";
import { toCsv } from "./csv";

const TREND_TEXT: Record<TrendVerdict, string> = {
  uptrend: "上昇基調",
  downtrend: "下落基調",
  sideways: "横ばい",
  unknown: "—",
};

export const COMPARISON_CSV_HEADERS = [
  "銘柄",
  "期間",
  "状態",
  "現在値",
  "通貨",
  "期間騰落率(%)",
  "指数(100基準)",
  "RSI(14)",
  "年率ボラ(%)",
  "最大下落率(%)",
  "MACD",
  "MACDシグナル",
  "MACDヒストグラム",
  "ボリンジャー上",
  "ボリンジャー中",
  "ボリンジャー下",
  "出来高変化(%)",
  "20日乖離(%)",
  "50日乖離(%)",
  "トレンド",
  "スコア",
] as const;

type Cell = string | number;

/** Rounds a finite number to `digits` decimals, or "" for null/undefined/non-finite. */
function round(value: number | null | undefined, digits = 2): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Period performance indexed to a common 100 baseline. */
function indexed100(periodReturnPercent: number | null | undefined): Cell {
  if (periodReturnPercent === null || periodReturnPercent === undefined || !Number.isFinite(periodReturnPercent)) {
    return "";
  }
  return round(100 + periodReturnPercent, 2);
}

const BLANK_DATA_COLUMNS = new Array(COMPARISON_CSV_HEADERS.length - 3).fill("") as Cell[];

export function buildComparisonRows(
  tickers: readonly string[],
  reports: Record<string, ReportState>,
  range: StockRange
): Cell[][] {
  const period = rangeLabel(range);
  const rows: Cell[][] = [[...COMPARISON_CSV_HEADERS]];

  for (const ticker of tickers) {
    const state = reports[ticker];
    if (!state) {
      rows.push([ticker, period, "未取得", ...BLANK_DATA_COLUMNS]);
      continue;
    }
    if (state.status === "loading") {
      rows.push([ticker, period, "読み込み中", ...BLANK_DATA_COLUMNS]);
      continue;
    }
    if (state.status === "error") {
      rows.push([ticker, period, "取得失敗", ...BLANK_DATA_COLUMNS]);
      continue;
    }
    const { metrics, analysis, currency } = state.report;
    rows.push([
      ticker,
      period,
      "取得済み",
      round(metrics.currentPrice),
      currency ?? "",
      round(metrics.periodReturnPercent),
      indexed100(metrics.periodReturnPercent),
      round(metrics.rsi14, 1),
      round(metrics.annualizedVolatilityPercent),
      round(metrics.maxDrawdownPercent),
      round(metrics.macd, 4),
      round(metrics.macdSignal, 4),
      round(metrics.macdHistogram, 4),
      round(metrics.bollingerUpper),
      round(metrics.bollingerMiddle),
      round(metrics.bollingerLower),
      round(metrics.volumeChangePercent),
      round(metrics.sma20DeviationPercent),
      round(metrics.sma50DeviationPercent),
      TREND_TEXT[analysis.trend],
      analysis.score ?? "",
    ]);
  }
  return rows;
}

/** Builds the full comparison CSV string for the given selection + window. */
export function buildComparisonCsv(
  tickers: readonly string[],
  reports: Record<string, ReportState>,
  range: StockRange
): string {
  return toCsv(buildComparisonRows(tickers, reports, range));
}
