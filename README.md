# Stock Insight Analyzer

FANG+ や個別の米国株について、Alpha Vantage の日次株価データを取得し、テクニカル指標とルールベースの分析を**ダッシュボード形式で可視化する参考ツール**です。

> **開発状況**: バックエンド API 基盤（Phase 1）に加え、Alpha Vantage 連携・テクニカル指標・チャート/比較表示・分析コメント（Phase 2〜6）まで実装済みです。`GET /api/stock/:ticker` は日次データを取得・分析した JSON を返します（API キー未設定時は `503 API_KEY_MISSING`）。テスト・セキュリティ強化・公開ドキュメント整備（Phase 7 以降）は今後の作業です。

> **免責事項**: 本ツールは情報提供を目的としたものであり、投資助言や特定銘柄の売買推奨ではありません。表示データの正確性・完全性・即時性は保証されず、価格は分割・配当調整前の終値（raw close）を用いています。過去の実績は将来の成果を保証しません。投資判断は利用者ご自身の責任で行ってください。

## 技術構成

| 領域 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript (Vite 6) / Recharts / zod |
| バックエンド | Express 5 + TypeScript / zod |
| 株価データ | Alpha Vantage API（`TIME_SERIES_DAILY`） |
| テスト | Vitest（backend / frontend）+ Supertest + React Testing Library |
| ランタイム | Node.js 20.19+ |

## 必要環境

- Node.js **20.19 以上**（Vite 6 / Vitest 4 の要件）
- npm 10 以上
- Alpha Vantage API キー（[無料取得](https://www.alphavantage.co/support/#api-key)）。**バックエンドにのみ**設定します。

## セットアップ

```bash
npm run install:all          # bash
npm.cmd run install:all      # Windows PowerShell
```

### 環境変数

プロジェクトルートに `.env` を作成します（`cp .env.example .env`）。

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `NODE_ENV` | 動作環境（`development` / `test` / `production`） | `development` |
| `PORT` | バックエンドのポート（1〜65535） | `3001` |
| `TRUST_PROXY` | 信頼するリバースプロキシ hop 数（0〜10）。`0` は `X-Forwarded-For` を無視 | `0` |
| `ALLOWED_ORIGINS` | 追加で許可する CORS オリジン（カンマ区切り）。本番以外は `http://localhost:5173` を常に許可 | 空 |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage の API キー。**バックエンドのみ**で使用 | 空 |
| `ALPHA_VANTAGE_TIMEOUT_MS` | 外部リクエストのタイムアウト（1000〜30000 ms） | `8000` |
| `STOCK_CACHE_MAX_ENTRIES` | キャッシュ最大件数（正整数）。LRU eviction | `100` |
| `STOCK_CACHE_TTL_MS` | キャッシュ TTL（1000〜86400000 ms） | `300000` |

> **API キーの取り扱い**: キーは**バックエンドのプロセス内のみ**で参照され、API レスポンスにもフロントエンドのバンドルにも含まれません。フロントエンドには絶対に API キーを置かないでください。`.env` は `.gitignore` 済みですが、コミット前に `git status` で含まれないことを確認してください。

フロントエンド用（任意）:

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `VITE_API_BASE_URL` | 別ホストの API を使う場合のベース URL（dev は Vite プロキシで同一オリジン） | 空 |
| `VITE_API_TIMEOUT_MS` | クライアント側リクエストのタイムアウト（ms） | `10000` |

## 起動・ビルド・型チェック

```bash
npm run dev            # frontend(5173) + backend(3001) 同時起動
npm run build          # frontend + backend をビルド
npm run typecheck      # frontend + backend の型チェック
```

開発時、フロントエンドの `/api` リクエストは Vite のプロキシでバックエンド（既定 `http://localhost:3001`、`VITE_API_PROXY_TARGET` で変更可）へ転送されます。

## テスト

通常テストは**外部ネットワークに接続しません**（Alpha Vantage 呼び出しと `fetch` はすべてモック）。

```bash
npm run test:run        # backend + frontend を一括実行
npm run test:backend    # backend（Vitest + Supertest）
npm run test:frontend   # frontend（Vitest + React Testing Library, jsdom）
```

> **実 API スモークテストについて**: 実際の Alpha Vantage への通信確認は、上記の自動テストとは**分離**しています。`ALPHA_VANTAGE_API_KEY` を設定して `npm run dev:backend` を起動し、`curl http://localhost:3001/api/stock/AAPL` で手動確認してください（自動テストスイートでは実行しません）。

## API 仕様

### `GET /api/stock/:ticker`

ティッカーを検証・正規化し、Alpha Vantage の日次データ（`outputsize=compact`、直近約 100 営業日）を取得・分析した次の JSON を返します。

```jsonc
{
  "ticker": "AAPL",
  "range": "100d",
  "currency": null,            // TIME_SERIES_DAILY は通貨を返さないため null
  "timezone": "US/Eastern",
  "lastRefreshed": "2026-06-19",
  "priceBasis": "close",       // raw close（分割・配当調整前）
  "series": [
    { "date": "2026-06-18", "open": 0, "high": 0, "low": 0, "close": 0,
      "adjustedClose": null, "volume": 0, "sma20": null, "sma50": null }
  ],
  "metrics": {
    "currentPrice": 0, "dailyChange": null, "dailyChangePercent": null,
    "periodReturnPercent": null, "sma20": null, "sma50": null, "rsi14": null,
    "annualizedVolatilityPercent": null, "maxDrawdownPercent": null
  },
  "analysis": {
    "trend": "uptrend", "momentum": "neutral", "risk": "low",
    "score": 100, "comments": ["..."]
  },
  "warnings": ["..."],
  "cache": { "hit": false, "expiresAt": "2026-06-19T00:05:00.000Z" },
  "disclaimer": "..."
}
```

- **priceBasis / adjustedClose**: 無料の `TIME_SERIES_DAILY` には調整後終値が無いため、`priceBasis` は常に `"close"`、`adjustedClose` は常に `null` です（株式分割・配当**調整前**の終値）。
- **数値の有限性**: すべての公開数値は有限（finite）であることを保証し、計算不能な場合は `null` を返します（NaN/Infinity を返しません）。フロントエンドも同じ zod 契約で検証します。
- **warnings**: 致命的でない注記（履歴不足・重複日付の調整など）。

### 指標の定義

| 指標 | 定義 |
|------|------|
| `currentPrice` | 直近終値 |
| `dailyChange` / `dailyChangePercent` | 前日比（額・率）。2 件未満・前日終値 0 のとき `null` |
| `periodReturnPercent` | 期間（先頭→末尾終値）の騰落率 |
| `sma20` / `sma50` | 単純移動平均（20 日 / 50 日） |
| `rsi14` | RSI(14)、Wilder 平滑化（0〜100） |
| `annualizedVolatilityPercent` | 日次対数収益率の標準偏差 × √252 |
| `maxDrawdownPercent` | 期間内の最大ピーク→ボトム下落率（非正値） |

分析（`analysis`）は移動平均との位置（trend）・RSI（momentum）・ボラティリティ/最大下落率（risk）から算出し、`score`（0〜100 のテクニカル状態スコア）と非助言の日本語コメントを付与します。**売買スコアではありません。**

### エラーコード（統一契約）

エラーは `{"error":{"code","message"}}` 形式（`details` は development のみ）。

| HTTP | code | 条件 |
|------|------|------|
| 400 | `INVALID_TICKER` | ティッカー形式が不正 |
| 400/413 | `INVALID_JSON` / `PAYLOAD_TOO_LARGE` | 不正 JSON / ボディ上限超過 |
| 403 | `FORBIDDEN_ORIGIN` | 許可外 Origin |
| 404 | `NOT_FOUND` / `SYMBOL_NOT_FOUND` | ルートなし / 銘柄データなし |
| 422 | `INSUFFICIENT_DATA` | データはあるが分析に不十分 |
| 429 | `RATE_LIMITED` / `PROVIDER_RATE_LIMITED` | 自サーバー / 提供元のレート制限 |
| 401 | `API_KEY_INVALID` | 提供元がキーを拒否 |
| 502 | `PROVIDER_UNAVAILABLE` / `PROVIDER_RESPONSE_INVALID` | 提供元不通 / 応答が不正（非 JSON・shape 不一致・cross-field 違反） |
| 503 | `API_KEY_MISSING` | API キー未設定 |
| 504 | `PROVIDER_TIMEOUT` | 提供元がタイムアウト |
| 500 | `INTERNAL_SERVER_ERROR` | 予期しないサーバーエラー（内部情報は非公開） |

> 提供元の生レスポンス・URL・API キーはエラーやログでクライアントへ公開しません。

### キャッシュと外部 API

- **サーバー側 LRU キャッシュ**: `ticker:range` をキーに分析済みレポートを `STOCK_CACHE_TTL_MS` の間保持。最大 `STOCK_CACHE_MAX_ENTRIES` 件で、超過時は期限切れ → LRU の順に 1 件 eviction。成功結果のみキャッシュします。
- **in-flight 重複排除**: 同一キーへの並行リクエストは 1 回の提供元呼び出しへ集約。成功・失敗いずれも完了後にクリアし、失敗はキャッシュせず再試行可能です。
- **タイムアウト**: 外部呼び出しは `ALPHA_VANTAGE_TIMEOUT_MS` で打ち切り、`PROVIDER_TIMEOUT` を返します。フロントエンドにも `VITE_API_TIMEOUT_MS` の独立タイムアウトがあります。
- **提供元の制限**: Alpha Vantage 無料枠は概ね **25 リクエスト/日**です。キャッシュと重複排除でこの枠を節約しています。

### CORS / レート制限 / ボディ / ティッカー（Phase 1 から継続）

- CORS は許可リスト方式（`*` 不使用）。許可外 Origin は `403 FORBIDDEN_ORIGIN`。
- `/api` 全体に基本リミッター、`/api/stock` に厳しめのリミッターを適用（ボディパーサーより前）。`/api/health` は対象外。draft-7 ヘッダー（`RateLimit` / `RateLimit-Policy`、429 時 `Retry-After`）。
- JSON ボディ上限 10KB（超過 `413` / 不正 `400`）。
- ティッカーは 1〜10 文字、ASCII 英数字と区切り `.` / `-`（例 `AAPL`, `BRK.B`, `BRK-B`）。ASCII 限定チェックを大文字化の**前**に適用。

## フロントエンド

- **FANG+ 参考プリセット**: AAPL / MSFT / GOOGL / AMZN / META / NFLX / NVDA / TSLA。これは **NYSE FANG+ 指数の公式構成を保証するものではなく**、構成は変更され得ます（出典・最終確認日は `frontend/src/lib/tickers.ts` のコメント参照）。
- 個別銘柄はクライアント側でも検証（サーバーが正とする）。
- レスポンスは zod 契約で検証してから描画（無検証 cast を行いません）。複数銘柄の比較表・終値＋SMA20/50 チャート・分析コメント・常時表示の免責フッターを備えます。
- **アクセシビリティ**: 銘柄切替は WAI-ARIA タブ（tablist/tab/tabpanel・矢印/Home/End）、loading は `role="status"`、error は `role="alert"`、チャートには読み上げ用のテキスト要約を併設します。

## npm scripts（主なもの）

| コマンド | 説明 |
|----------|------|
| `install:all` | root / frontend / backend を一括インストール |
| `dev` / `dev:frontend` / `dev:backend` | 開発起動 |
| `build` / `build:frontend` / `build:backend` | ビルド |
| `start:backend` | backend ビルド成果物を起動 |
| `typecheck` | frontend + backend 型チェック |
| `test:run` / `test:backend` / `test:frontend` | テスト実行（外部通信なし） |

## 現在未実装 / 今後の作業（Phase 7 以降）

- フロントエンド/バックエンドの統合テスト拡充、アクセシビリティの網羅確認
- セキュリティの総合確認（ヘッダー検証・エラー露出・入力網羅）
- 公開用ドキュメント整備、利用規約、デプロイ手順、CI（GitHub Actions）
- 本番ビルド最適化（Recharts/zod を含むバンドルのコード分割等）

## ライセンス

[MIT License](LICENSE)
