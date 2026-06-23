# Stock Insight Analyzer

FANG+ や個別の米国株について、Alpha Vantage の日次株価データを取得し、テクニカル指標とルールベースの分析を**ダッシュボード形式で可視化する参考ツール**です。

> **開発状況**: バックエンド API 基盤（Phase 1）、Alpha Vantage 連携・テクニカル指標・チャート/比較表示・分析コメント（Phase 2〜6）、公開に向けた基盤強化（Phase 7〜11）、さらに **CSV/SQLite 履歴データ基盤・不足営業日の API 補完・日次バッチ・データ状態表示（Phase 12〜15）** まで実装済みです。具体的には、複数期間の切替（**1か月 / 3か月**）、メモリ＋ディスクの 2 層キャッシュ（live/mock を厳密に分離）、構造化ログ・相関 ID、`/api/health`（liveness）/`/api/ready`（readiness）、グレースフルシャットダウン、Recharts の遅延ロード、アクセシビリティ強化を含みます。`GET /api/stock/:ticker` は日次データを取得・分析した JSON を返します（API キー未設定時は `503 API_KEY_MISSING`）。
>
> **対応期間について**: 無料の `TIME_SERIES_DAILY`（`outputsize=compact`）は直近約 100 営業日しか返さないため、誠実に裏付けできる **1か月（約21営業日）/ 3か月（約63営業日）のみ**を提供します。**6か月・1年は未対応**で、UI には表示されず、API も `400 INVALID_RANGE` で拒否します（同じ約100営業日を「6か月/1年」と偽って返すことはしません）。6か月・1年の本対応は `outputsize=full` を使う将来の変更として明示的に保留しています。

> **免責事項**: 本ツールは情報提供を目的としたものであり、投資助言や特定銘柄の売買推奨ではありません。表示データの正確性・完全性・即時性は保証されず、価格は分割・配当調整前の終値（raw close）を用いています。過去の実績は将来の成果を保証しません。投資判断は利用者ご自身の責任で行ってください。

## 技術構成

| 領域 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript (Vite 6) / Recharts / zod |
| バックエンド | Express 5 + TypeScript / zod |
| 株価データ | Alpha Vantage API（`TIME_SERIES_DAILY`） |
| テスト | Vitest（backend / frontend）+ Supertest + React Testing Library |
| ランタイム | Node.js 22.5+ |

## 必要環境

- Node.js **22.5 以上**（`historical` / `hybrid` と CSV 取込・日次バッチが標準の `node:sqlite` を使い、これが Node ≥ 22.5 を要求するため。Vite 6 / Vitest 4 の要件も満たします）
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
| `TRUST_PROXY` | 信頼するリバースプロキシ hop 数（0〜10）。`0` は `X-Forwarded-For` を無視。実段数を超えて設定しない | `0` |
| `ALLOWED_ORIGINS` | 追加で許可する CORS オリジン（カンマ区切り、`*` 不可）。本番以外は `http://localhost:5173` を常に許可。**`production` では必須**（未設定は起動失敗） | 空 |
| `STOCK_DATA_MODE` | データ取得元（`live` / `mock` / `historical` / `hybrid`）。`mock`=外部通信なしの決定的ダミー、`historical`=SQLite のみ、`hybrid`=SQLite 優先＋不足時のみ API 補完（失敗時は保存データへフォールバック）。`mock` は本番では起動時に拒否。`historical` / `hybrid` は Node ≥ 22.5 が必要 | `live` |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage の API キー。**バックエンドのみ**で使用（`live` モード時のみ）。`live` で未設定でも起動はするが、`/api/ready` が `not_ready` を返し、株価リクエストは `503 API_KEY_MISSING` になる | 空 |
| `ALPHA_VANTAGE_TIMEOUT_MS` | 外部リクエストのタイムアウト（1000〜30000 ms） | `8000` |
| `ALPHA_VANTAGE_MAX_POINTS` | Alpha Vantage レスポンスから処理する最大時系列件数（1〜10000 の整数）。超過は `PROVIDER_RESPONSE_INVALID`（黙って切り捨てない）。不正値・小数・範囲外は起動時に拒否 | `120` |
| `STOCK_CACHE_MAX_ENTRIES` | キャッシュ最大件数（正整数）。メモリ層・ディスク層の両方に適用、LRU eviction | `100` |
| `STOCK_CACHE_TTL_SECONDS` | キャッシュ TTL（**秒**、1〜86400）。日次バーは引け後のみ更新されるため数時間で十分 | `21600`（6時間） |
| `STOCK_CACHE_DIR` | 永続（ディスク）キャッシュの保存先。検証済みの公開 `StockReport` のみを `ticker:range:dataMode` 単位で保存（API キーや生レスポンスは保存しない）。相対パスは CWD 起点。本番は書込可能な永続ボリュームへ。書込不可ならメモリのみへ自動降格 | `.cache/stock-reports` |
| `STOCK_DB_PATH` | SQLite 履歴 DB のパス（履歴株価の正本）。既定は git 無視の `.cache/` 配下。DB と `-wal`/`-shm` は git 無視。`historical`/`hybrid` と データ CLI で使用（Node ≥ 22.5） | `.cache/stock-data/history.sqlite` |
| `STOCK_CSV_DIRECTORY` | 日次ジョブが取込対象とする CSV ディレクトリ（任意。空=CSV 取込なし） | 空 |
| `STOCK_SYNC_TICKERS` | 日次ジョブが同期する既定ティッカー（カンマ区切り、任意） | 空 |
| `STOCK_STALE_AFTER_HOURS` | 最新バーからこの時間を超えると「stale」表示＆同日再同期を許可（1〜168） | `24` |
| `STOCK_IMPORT_MAX_ROWS` | CSV 1 取込あたりの最大データ行数（正整数） | `100000` |
| `STOCK_IMPORT_MAX_BYTES` | CSV 1 取込あたりの最大バイト数（正整数） | `5000000` |
| `STOCK_DAILY_LOCK_TIMEOUT_SECONDS` | 日次ジョブの lock がこの秒数を過ぎると stale 扱いで再取得可能（異常終了で永久 lock が残らない、60〜86400） | `3600` |

> **本番（`NODE_ENV=production`）で必須の設定**: `ALLOWED_ORIGINS`（未設定は**起動失敗**）。`STOCK_DATA_MODE=mock` は**起動失敗**。`live` で `ALPHA_VANTAGE_API_KEY` 未設定の場合は起動はするが `/api/ready` が `not_ready`（503）を返す。フロントエンドは別オリジン配信のため `VITE_API_BASE_URL` も実質必須。

> **API キーの取り扱い**: キーは**バックエンドのプロセス内のみ**で参照され、API レスポンス・ログ・永続キャッシュ・フロントエンドのバンドルのいずれにも含まれません。フロントエンドには絶対に API キーを置かないでください。`.env` は `.gitignore` 済みですが、コミット前に `git status` で含まれないことを確認してください。

フロントエンド用（任意）:

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `VITE_API_BASE_URL` | 別ホストの API を使う場合のベース URL（dev は Vite プロキシで同一オリジン） | 空 |
| `VITE_API_TIMEOUT_MS` | クライアント側リクエストのタイムアウト（ms） | `10000` |

## API 消費を抑える設計（開発時の推奨）

Alpha Vantage の無料枠（概ね 25 リクエスト/日）を浪費しないよう、次の方針で動作します。

- **通常開発では `STOCK_DATA_MODE=mock` を推奨**します。外部通信せず決定的なダミーデータで UI・指標・チャートを確認できます（`.env.example` も既定で `mock`）。実 API の確認時のみ `STOCK_DATA_MODE=live` を明示し、`ALPHA_VANTAGE_API_KEY` を設定してください。`live` / `mock` の切り替えは**プロバイダ層**で行い、ルートやフロントエンドにモード判定を持ち込みません。`mock` レスポンスは画面に「開発用モックデータを表示しています。」と明示します。
- **起動時は API 通信を行いません**。初期表示は「銘柄を選択すると株価データを取得します。」の案内のみで、リロードや React StrictMode の effect 二重実行でも外部通信は 0 回です。
- **選択した 1 銘柄・1 期間だけ取得**します。プリセット／タブ／個別追加／期間切替の操作で対象 1（銘柄, 期間）のみを取得し、`ticker:range` 単位で in-flight 重複排除とキャッシュ分離を行います。比較表は**取得済み銘柄のみ値を表示**（未取得は「未取得」）。比較表が一括取得を起こすことはありません。
- **期間切替で不要な再通信は発生しません**。各（銘柄, 期間）は独立にキャッシュされ、読み込み済みの期間へ戻っても再取得しません。1か月と3か月は同じ compact レスポンスを末尾 N 営業日に切り出すため、それぞれ異なる期間を返します。
- **API 制限時は自動再試行しません**。`PROVIDER_RATE_LIMITED` を受けても自動リトライ・タイマー・他銘柄への継続取得は行わず、共通エラーを画面上部に 1 件だけ表示します（比較表の各行は「取得できませんでした」のみ）。再試行はユーザーの明示操作のみで、処理中は再試行ボタンを無効化（連打不可）します。
- **2 層キャッシュ（メモリ＋ディスク）**。`ticker:range` をキーに成功レポートのみを `STOCK_CACHE_TTL_SECONDS`（既定 6 時間）保持し、最大 `STOCK_CACHE_MAX_ENTRIES` 件で LRU eviction（ディスク層は**最終アクセス時刻**で真の LRU、期限切れを優先削除）。**メモリ層は再起動で消えます**が、ディスク層（`STOCK_CACHE_DIR`）は再起動後も再利用されます（公開 schema を毎回再検証してから提供）。ディスク層は live/mock を `dataMode` で厳密に分離して保存し、実行モードと一致しないエントリは cache miss 扱い（不一致・破損・期限切れ・schema 不一致は読込時に削除）。API キーや提供元の生レスポンスは保存しません。
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

ティッカーと任意の `?range=`（`1m` / `3m`、既定 `3m`）を検証・正規化し、Alpha Vantage の日次データ（`outputsize=compact`、直近約 100 営業日）を取得して要求期間の末尾 N 営業日に切り出し、分析した次の JSON を返します。未対応の期間（`6m` / `1y` など）は `400 INVALID_RANGE` で拒否します。

```jsonc
{
  "ticker": "AAPL",
  "source": "live",            // データ取得元（"live" = Alpha Vantage / "mock" = 開発用ダミー）。必須
  "range": "3m",               // 対応期間は "1m" / "3m" のみ
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

- **2 層キャッシュ（メモリ＋ディスク）**: `ticker:range` をキーに、検証済みの公開レポートのみを保持します。
  - **メモリ層**: TTL `STOCK_CACHE_TTL_SECONDS`（既定 6 時間）、最大 `STOCK_CACHE_MAX_ENTRIES` 件、LRU eviction。**プロセス再起動で消えます**。
  - **ディスク層（永続）**: `STOCK_CACHE_DIR` にファイルとして保存し、**再起動後も再利用**されます。最終アクセス時刻による真の LRU で、期限切れを優先削除。書込は atomic（temp→rename）、書込不可ならメモリのみへ自動降格。読込時は schema version・TTL・キー・**dataMode**・`source` 整合性を毎回検証し、ヒット時も公開 schema を再検証してから提供します。
  - **live/mock の分離**: ディスク層は `dataMode` をファイル名とメタデータに記録し、live と mock を厳密に分離。実行モードと一致しないエントリは cache miss として扱い削除します（mock データが `source:"live"` として公開されることはありません）。
  - **保存しないもの**: API キー、提供元の生レスポンス。SQLite/Redis は使用しません（ファイルベース）。
- **in-flight 重複排除**: 同一キーへの並行リクエストは 1 回の提供元呼び出しへ集約。成功・失敗いずれも完了後にクリアし、失敗はキャッシュせず再試行可能です。
- **タイムアウト**: 外部呼び出しは `ALPHA_VANTAGE_TIMEOUT_MS` で打ち切り、`PROVIDER_TIMEOUT` を返します。フロントエンドにも `VITE_API_TIMEOUT_MS` の独立タイムアウトがあります。
- **提供元の制限**: Alpha Vantage 無料枠は概ね **25 リクエスト/日**です。起動時通信 0 回・選択 1 銘柄 1 期間のみ取得・2 層キャッシュ・重複排除でこの枠を節約しています。

### 監視（Health / Readiness）とシャットダウン

- **`GET /api/health`（liveness）**: プロセス生存確認の軽量 200 応答。レート制限・body parser・provider 通信を通しません。
- **`GET /api/ready`（readiness）**: 「リクエスト処理可能か」を返します。プロセス内設定のみで判定し、Alpha Vantage へは通信しません。`live` モードで API キー未設定など、株価リクエストが必ず失敗する設定不備のときは `503 not_ready` と安全なタグ（例 `alpha_vantage_api_key_missing`、**キー値は含めない**）を返します。
- **グレースフルシャットダウン**: `SIGINT`/`SIGTERM` で新規受付を停止し、in-flight を drain してから終了。停滞時は強制終了、重複シグナルは無視します。
- **構造化ログ**: 全応答に相関 ID `X-Request-Id` を付与し、1 リクエスト 1 ログ（JSON）を出力。API キー・provider 本文・クエリ文字列・stack・ローカル絶対パスは記録しません（予期しない例外も生 Error をそのまま出力せず、安全なフィールドのみ記録）。

### CORS / レート制限 / ボディ / ティッカー（Phase 1 から継続）

- CORS は許可リスト方式（`*` 不使用）。許可外 Origin は `403 FORBIDDEN_ORIGIN`。
- `/api` 全体に基本リミッター、`/api/stock` に厳しめのリミッターを適用（ボディパーサーより前）。`/api/health` は対象外。draft-7 ヘッダー（`RateLimit` / `RateLimit-Policy`、429 時 `Retry-After`）。
- JSON ボディ上限 10KB（超過 `413` / 不正 `400`）。
- ティッカーは 1〜10 文字、ASCII 英数字と区切り `.` / `-`（例 `AAPL`, `BRK.B`, `BRK-B`）。ASCII 限定チェックを大文字化の**前**に適用。

## フロントエンド

- **FANG+ 参考プリセット**: AAPL / MSFT / GOOGL / AMZN / META / NFLX / NVDA / TSLA。これは **NYSE FANG+ 指数の公式構成を保証するものではなく**、構成は変更され得ます（出典・最終確認日は `frontend/src/lib/tickers.ts` のコメント参照）。
- **対応期間**: **1か月 / 3か月のみ**。6か月・1年は未対応で UI に表示されません（理由は冒頭「対応期間について」を参照）。
- 個別銘柄はクライアント側でも検証（サーバーが正とする）。
- レスポンスは zod 契約で検証してから描画（無検証 cast を行いません）。複数銘柄の比較表・終値＋SMA20/50 チャート・分析コメント・常時表示の免責フッターを備えます。
- **Recharts の遅延ロード**: 最も重い依存である Recharts はチャート表示時にのみ取得します。`React.lazy` + `Suspense` で `PriceChart` を動的 import し、エントリ chunk からの静的依存・`index.html` の `modulepreload` を排除しているため、初期表示では取得されません。
- **アクセシビリティ**: 銘柄切替は WAI-ARIA タブ（tablist/tab/tabpanel・矢印/Home/End・roving tabindex）。期間切替は `aria-pressed` のトグル群で、切替時に**フォーカスを奪わず**（押したボタン/タブに残す）、開始・成功を `aria-live="polite"` で銘柄名＋期間名つきで通知します。エラー時のみエラー領域（`role="alert"`）へフォーカス移動。loading は `role="status"`、チャートには読み上げ用テキスト要約を併設。主要画面幅（320px〜1440px）でレスポンシブに動作します。
- **ウォッチリストの永続化は未実装**です（選択銘柄はリロードで保持されません。localStorage 等への保存は今後の作業）。

## npm scripts（主なもの）

| コマンド | 説明 |
|----------|------|
| `install:all` | root / frontend / backend を一括インストール |
| `dev` / `dev:frontend` / `dev:backend` | 開発起動 |
| `build` / `build:frontend` / `build:backend` | ビルド |
| `start:backend` | backend ビルド成果物を起動 |
| `typecheck` | frontend + backend 型チェック |
| `test:run` / `test:backend` / `test:frontend` | テスト実行（外部通信なし） |
| `data:import -- --file "<CSV>"` | CSV を検証して SQLite へ冪等に取込（Node ≥ 22.5） |
| `data:import -- --directory "<DIR>"` | ディレクトリ内の `*.csv` を一括取込 |
| `data:daily [-- --csv-directory "<DIR>" --tickers "AAPL,MSFT"]` | 日次バッチ（二重起動防止・CSV 取込・API 補完） |

## 本番配信時のセキュリティヘッダ（フロントエンド）

backend は **JSON 専用 API**（CSP `default-src 'none'`）で、SPA の HTML は配信しません。**SPA の HTML は backend の helmet では保護されません**。フロントエンド（`frontend/dist`）は CDN / 静的ホスティング側で以下のヘッダを付与してください。

- **CSP**: SPA 用に最小限を設定。例: `default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`（実際の API オリジンに合わせて `connect-src` を調整）。
- **CORS**: 株価 API は backend の `ALLOWED_ORIGINS` 許可リストで制御（`*` 不可、許可外は `403 FORBIDDEN_ORIGIN`）。静的アセット自体は同一オリジン配信のため通常 CORS 不要。
- **Permissions-Policy**: 不要機能を全拒否。例: `geolocation=(), camera=(), microphone=(), payment=(), usb=()`。
- 併せて `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、HTTPS では `Strict-Transport-Security` を付与。

配信側ヘッダー設定例（抜粋。詳細は `docs/DEPLOYMENT.md`）:

- **Nginx**: `add_header Content-Security-Policy "..."; add_header X-Content-Type-Options nosniff; add_header Referrer-Policy no-referrer; add_header Permissions-Policy "geolocation=(), camera=(), microphone=()";`
- **Netlify** (`netlify.toml` の `[[headers]]`) / **Vercel** (`vercel.json` の `headers`): 同等のキーを `for = "/*"` に対して設定。
- **CDN（CloudFront 等）**: Response Headers Policy で同等のヘッダを付与。

## 履歴データ基盤（Phase 12〜15）

CSV で取得した過去の日足を検証して **SQLite（履歴株価の正本）** へ冪等に保存し、必要なときだけ不足営業日を API で補完する基盤です。詳細は **[docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md)**（データフロー・スキーマ・障害復旧）と **[docs/CSV_FORMAT.md](docs/CSV_FORMAT.md)**（CSV 仕様）を参照してください。

- **データモード**: `mock`（外部通信 0・DB なし）/ `historical`（SQLite のみ・外部通信 0）/ `hybrid`（SQLite 優先＋不足時のみ API 補完、失敗時は保存データへフォールバック）/ `live`（従来の直接取得）。
- **API 通信が発生する条件**: `hybrid` で対象ティッカーを選択し、SQLite の最新営業日が直近の確定営業日より古く、かつ直近 `STOCK_STALE_AFTER_HOURS` に同期試行がない場合のみ、**ティッカー 1 件につき最大 1 回**。
- **API 通信が発生しない条件**: 起動時・画面初期表示・`mock`/`historical`・SQLite が十分新しい・同日に試行済み・レート制限/タイムアウト後の再試行（自動再試行はしない）。
- **Alpha Vantage は単一日取得ではありません**。日次 API は最新 ~100 営業日（compact）を返し、その中から **SQLite より新しい日付だけ**を保存します。
- **SQLite ライブラリ**: Node 標準の `node:sqlite`（`DatabaseSync`）。ネイティブビルド不要で Windows ARM でも追加依存なしに動作します（**Node ≥ 22.5 が必要**、実験的 API のため起動時に ExperimentalWarning を出します）。

## 既知の制限

- **ウォッチリストの永続化は未実装**（選択銘柄はリロードで失われます。今回も対象外）。
- **キャッシュの制限**: メモリ層は再起動で消えます。ディスク層は再起動後も再利用されますが、`STOCK_CACHE_DIR` が書込不可ならメモリのみで動作します。schema 変更時は旧エントリを読込時に無効化・削除します。
- **mock / 営業日カレンダーは完全な取引所カレンダーではありません**。主要な全日休場のみをモデル化し、早朝引け・臨時休場は対象外です。最終的な最新日は Provider レスポンスの日付を正とします。
- **対応期間は 1か月 / 3か月のみ**（6か月・1年は無料 compact フィードでは誠実に提供できないため未対応）。
- **プロジェクト全体の要件は Node ≥ 22.5**。`historical` / `hybrid` と データ CLI（CSV 取込・日次バッチ）が標準の `node:sqlite` を使うため、`engines.node` を root / backend / frontend で `>=22.5.0` に統一しています。`mock` / `live` のコードパス自体は Node ≥ 20.19 でも動作しますが（`node:sqlite` を遅延ロードするため）、公開・運用時はリポジトリ統一要件の Node ≥ 22.5 を満たしてください。
- **`hybrid` の API 補完は ≥ 直近 1 日のギャップ補填**で、最新より過去の歯抜けは日次取込の対象外です（履歴の書き換えを避けるため）。

## 今後の作業（Phase 16 以降・未着手）

- 6か月・1年の本対応（`outputsize=full` の採用検討）
- ウォッチリストの localStorage 永続化
- 過去日の歯抜け補填（バックフィル）と複数プロバイダ対応
- CI（GitHub Actions）整備

## ライセンス

[MIT License](LICENSE)
