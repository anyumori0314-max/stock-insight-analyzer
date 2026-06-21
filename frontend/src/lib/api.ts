import { stockReportSchema } from "./reportSchema";
import type { ApiErrorBody, StockReport } from "../types/stock";

/**
 * Optional base URL. In development the Vite proxy forwards `/api` to the
 * backend (same-origin); in production point it at the API host via
 * `VITE_API_BASE_URL`. The Alpha Vantage key is NEVER referenced here — it lives
 * only on the backend.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

const DEFAULT_TIMEOUT_MS = 10_000;

function resolveTimeoutMs(): number {
  const raw = import.meta.env.VITE_API_TIMEOUT_MS;
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/** A failed request, carrying the backend's stable error code when available. */
export class StockApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "StockApiError";
    this.code = code;
    this.status = status;
  }
}

/** Maps stable error codes to friendly, user-facing Japanese messages. */
export function friendlyMessage(code: string, status: number): string {
  switch (code) {
    case "INVALID_TICKER":
      return "ティッカーの形式が正しくありません。";
    case "SYMBOL_NOT_FOUND":
      return "該当する銘柄のデータが見つかりませんでした。";
    case "INSUFFICIENT_DATA":
      return "分析に十分なデータがありませんでした。";
    case "PROVIDER_RATE_LIMITED":
    case "RATE_LIMITED":
      return "データ提供元の利用上限に達しました。しばらくしてから再度お試しください。";
    case "PROVIDER_TIMEOUT":
      return "データ提供元の応答が遅延しています。時間をおいて再度お試しください。";
    case "PROVIDER_UNAVAILABLE":
      return "データ提供元に接続できませんでした。時間をおいて再度お試しください。";
    case "PROVIDER_RESPONSE_INVALID":
      return "データ提供元から想定外の応答がありました。時間をおいて再度お試しください。";
    case "API_KEY_MISSING":
      return "現在、株価データを取得できません（APIキー未設定）。";
    case "API_KEY_INVALID":
      return "現在、株価データを取得できません（APIキー設定エラー）。";
    case "RESPONSE_INVALID":
      return "サーバーからの応答を解釈できませんでした。時間をおいて再度お試しください。";
    case "TIMEOUT":
      return "応答がタイムアウトしました。時間をおいて再度お試しください。";
    case "NETWORK_ERROR":
      return "ネットワークに接続できませんでした。接続を確認してください。";
    default:
      return status >= 500
        ? "サーバーでエラーが発生しました。時間をおいて再度お試しください。"
        : "リクエストを処理できませんでした。";
  }
}

/**
 * Fetches and validates the analyzed report for a ticker.
 *
 * - Adds a client-side timeout (independent of, and combined with, an optional
 *   caller `signal`).
 * - Validates the response against the zod contract; an invalid shape is a
 *   safe `RESPONSE_INVALID` error (internal payloads are never surfaced).
 * - Re-throws genuine caller aborts unchanged so the hook can ignore them
 *   (they are not user-facing errors).
 */
export async function fetchStockReport(
  ticker: string,
  signal?: AbortSignal
): Promise<StockReport> {
  const url = `${API_BASE}/api/stock/${encodeURIComponent(ticker)}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, resolveTimeoutMs());

  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (timedOut) {
      throw new StockApiError(friendlyMessage("TIMEOUT", 0), "TIMEOUT", 0);
    }
    if (signal?.aborted) {
      throw err; // genuine caller cancellation — let the hook ignore it
    }
    throw new StockApiError(friendlyMessage("NETWORK_ERROR", 0), "NETWORK_ERROR", 0);
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", onCallerAbort);
    }
  }

  if (!response.ok) {
    let code = "UNKNOWN";
    try {
      const body = (await response.json()) as ApiErrorBody;
      code = body?.error?.code ?? "UNKNOWN";
    } catch {
      // Non-JSON error body; fall back to the status-derived message.
    }
    throw new StockApiError(friendlyMessage(code, response.status), code, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StockApiError(friendlyMessage("RESPONSE_INVALID", 200), "RESPONSE_INVALID", 200);
  }

  const parsed = stockReportSchema.safeParse(payload);
  if (!parsed.success) {
    throw new StockApiError(friendlyMessage("RESPONSE_INVALID", 200), "RESPONSE_INVALID", 200);
  }

  return parsed.data;
}
