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
| `STOCK_DATA_MODE` | データ取得元（`live` / `mock`）。`mock` は外部通信せず決定的なダミーデータを返す（本番では `mock` を起動時に拒否） | `live` |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage の API キー。**バックエンドのみ**で使用（`live` モード時のみ） | 空 |
| `ALPHA_VANTAGE_TIMEOUT_MS` | 外部リクエストのタイムアウト（1000〜30000 ms） | `8000` |
| `ALPHA_VANTAGE_MAX_POINTS` | Alpha Vantage レスポンスから処理する最大時系列件数（1〜10000 の整数）。超過は `PROVIDER_RESPONSE_INVALID`（黙って切り捨てない）。不正値・小数・範囲外は起動時に拒否 | `120` |
| `STOCK_CACHE_MAX_ENTRIES` | キャッシュ最大件数（正整数）。LRU eviction | `100` |
| `STOCK_CACHE_TTL_SECONDS` | キャッシュ TTL（**秒**、1〜86400）。日次バーは引け後のみ更新されるため数時間で十分 | `21600`（6時間） |

> **API キーの取り扱い**: キーは**バックエンドのプロセス内のみ**で参照され、API レスポンスにもフロントエンドのバンドルにも含まれません。フロントエンドには絶対に API キーを置かないでください。`.env` は `.gitignore` 済みですが、コミット前に `git status` で含まれないことを確認してください。

フロントエンド用（任意）:

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `VITE_API_BASE_URL` | 別ホストの API を使う場合のベース URL（dev は Vite プロキシで同一オリジン） | 空 |
| `VITE_API_TIMEOUT_MS` | クライアント側リクエストのタイムアウト（ms） | `10000` |

## API 消費を抑える設計（開発時の推奨）

Alpha Vantage の無料枠（概ね 25 リクエスト/日）を浪費しないよう、次の方針で動作します。

- **通常開発では `STOCK_DATA_MODE=mock` を推奨**します。外部通信せず決定的なダミーデータで UI・指標・チャートを確認できます（`.env.example` も既定で `mock`）。実 API の確認時のみ `STOCK_DATA_MODE=live` を明示し、`ALPHA_VANTAGE_API_KEY` を設定してください。`live` / `mock` の切り替えは**プロバイダ層**で行い、ルートやフロントエンドにモード判定を持ち込みません。`mock` レスポンスは画面に「開発用モックデータを表示しています。」と明示します。
- **起動時は API 通信を行いません**。初期表示は「銘柄を選択すると株価データを取得します。」の案内のみで、リロードや React StrictMode の effect 二重実行でも外部通信は 0 回です。
- **選択した 1 銘柄だけ取得**します。プリセット／タブ／個別追加の操作で対象 1 銘柄のみを取得し、比較表は**取得済み銘柄のみ値を表示**（未取得は「未取得」）。比較表が一括取得を起こすことはありません。
- **API 制限時は自動再試行しません**。`PROVIDER_RATE_LIMITED` を受けても自動リトライ・タイマー・他銘柄への継続取得は行わず、共通エラーを画面上部に 1 件だけ表示します（比較表の各行は「取得できませんでした」のみ）。再試行はユーザーの明示操作のみで、処理中は再試行ボタンを無効化（連打不可）します。
- **インメモリキャッシュは再起動で消えます**。`ticker:range` をキーに成功レポートのみを `STOCK_CACHE_TTL_SECONDS`（既定 6 時間）保持し、最大 `STOCK_CACHE_MAX_ENTRIES` 件で LRU eviction。API キーや提供元の生レスポンスは保存しません。SQLite/Redis などの永続キャッシュは使用しません。
- **実 API テストは必要最小限**にとどめます（下記スモークテスト参照）。自動テストは外部通信しません。

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
  "source": "live",            // データ取得元（"live" = Alpha Vantage / "mock" = 開発用ダミー）。必須
  "range": "100d",             // MVP は "100d" 固定
  "currency": null,            // TIME_SERIES_DAILY は通貨を返さないため常に null
  "timezone": "US/Eastern",
  "lastRefreshed": "2026-06-19",
  "priceBasis": "close",       // raw close（分割・配当調整前）
  "series": [
    // 古い順（昇順）。直近約100営業日のうち末尾2件のみ抜粋
    { "date": "2026-06-18", "open": 198.40, "high": 201.20, "low": 197.90, "close": 200.00,
      "adjustedClose": null, "volume": 41250000, "sma20": 196.80, "sma50": 188.45 },
    { "date": "2026-06-19", "open": 200.50, "high": 205.10, "low": 200.10, "close": 204.00,
      "adjustedClose": null, "volume": 38900000, "sma20": 197.55, "sma50": 189.10 }
  ],
  "metrics": {
    "currentPrice": 204.00,        // 最新終値（series 末尾の close と一致）
    "dailyChange": 4.00,           // 204.00 − 200.00
    "dailyChangePercent": 2.00,    // (204.00 − 200.00) / 200.00 × 100
    "periodReturnPercent": 15.40,
    "sma20": 197.55, "sma50": 189.10, "rsi14": 61.20,
    "annualizedVolatilityPercent": 24.80, "maxDrawdownPercent": -8.30
  },
  "analysis": {
    "trend": "uptrend", "momentum": "neutral", "risk": "low",
    "score": 78, "comments": ["終値は20日・50日移動平均を上回り、上昇基調です。"]
  },
  "warnings": [],
  "cache": { "hit": false, "expiresAt": "2026-06-19T06:00:00.000Z" },
  "disclaimer": "（免責事項の全文。投資助言ではありません…）"
}
```

> 上の `series` は表示の都合で末尾 2 件のみを抜粋しています（実際は直近約 100 営業日）。`sma20` / `sma50` などの指標は全期間から算出されます。

- **source**: データ取得元を示す必須項目です（`"live"` = Alpha Vantage、`"mock"` = 開発用ダミー）。プロバイダ層で切り替え、レスポンスに常に含まれます。
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

- **サーバー側 LRU キャッシュ**: `ticker:range` をキーに分析済みレポートを `STOCK_CACHE_TTL_SECONDS`（既定 6 時間）の間保持。最大 `STOCK_CACHE_MAX_ENTRIES` 件で、超過時は期限切れ → LRU の順に 1 件 eviction。成功結果のみキャッシュし、再起動で消えるインメモリ方式です。
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
