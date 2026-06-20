# Stock Insight Analyzer

FANG+や個別米国株の株価データを取得し、投資判断の参考になる分析情報をダッシュボード形式で表示するWebアプリです。

> **開発状況**: 本プロジェクトは現在開発中です。バックエンドAPI基盤（Phase 1）まで完了しており、ヘルスチェック・ティッカー入力バリデーション・CORS・セキュリティヘッダー・エラーハンドリング・テスト基盤が実装済みです。Alpha Vantage API との連携による株価データ取得や分析機能（Phase 2 以降）はまだ実装されていません。`/api/stock/:ticker` は現時点では `501 Not Implemented` を返します。

> **免責事項**: 本アプリは特定銘柄の売買を推奨するものではなく、投資助言を目的としたものでもありません。表示される情報は過去の株価データに基づく参考情報であり、将来のパフォーマンスを予測・保証するものではありません。投資に関する最終判断はご自身の責任で行ってください。

## 技術構成

| 領域 | 技術 |
|------|------|
| フロントエンド | React + TypeScript (Vite) |
| バックエンド | Express + TypeScript |
| 株価データ | Alpha Vantage API |
| パッケージ管理 | npm |
| ランタイム | Node.js 20.19+ |

## 必要環境

- Node.js **20.19 以上**（Vite 6 / Vitest 4 の要件。Node 18 はサポート対象外）
- npm 10 以上
- Alpha Vantage API キー（[無料取得](https://www.alphavantage.co/support/#api-key)、Phase 2 以降で必要。Phase 1 では不要）

## セットアップ

### リポジトリの取得

> リポジトリの公開URLは未確定です。ローカル環境にソースコードを配置してから以降の手順に進んでください。

### インストール

```bash
npm run install:all
```

Windows PowerShell の場合:

```powershell
npm.cmd run install:all
```

### 環境変数の設定

プロジェクトルートに `.env` ファイルを作成してください。

```bash
cp .env.example .env
```

Windows PowerShell の場合:

```powershell
Copy-Item .env.example .env
```

`.env` を編集して必要な値を設定してください:

```
# 動作環境: development | test | production
NODE_ENV=development
# バックエンドのポート番号
PORT=3001
# 信頼するリバースプロキシのhop数（0=信頼しない。プロキシ配下では実台数に設定）
TRUST_PROXY=0
# 追加で許可する CORS オリジン（カンマ区切り。本番以外では localhost:5173 を常に許可）
ALLOWED_ORIGINS=
# Alpha Vantage API キー（Phase 1 では不要、Phase 2 以降で必要）
ALPHA_VANTAGE_API_KEY=
```

> **重要**: `.env` ファイルには API キーなどの機密情報が含まれます。`.env` は `.gitignore` で除外されていますが、**絶対に Git にコミットしないでください**。コミット前に `git status` で `.env` が含まれていないことを確認してください。Phase 1 では Alpha Vantage API キーは不要で、空のままでもバックエンドは起動します。

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `NODE_ENV` | 動作環境（`development` / `test` / `production`） | `development` |
| `PORT` | バックエンドサーバーのポート番号（1〜65535の整数） | `3001` |
| `TRUST_PROXY` | 信頼するリバースプロキシの hop 数（0〜10の整数）。`0` は信頼せず `req.ip` を直結ソケットアドレスにし、`X-Forwarded-For` を無視。プロキシ配下では実台数を設定 | `0` |
| `ALLOWED_ORIGINS` | 追加で許可する CORS オリジン（カンマ区切り）。本番以外では `http://localhost:5173` を常に許可 | なし（空） |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API のキー（Phase 1 では不要、Phase 2 以降で必要） | なし |

> 不正な環境変数（範囲外の `PORT`、非整数の `TRUST_PROXY`、未知の `NODE_ENV` 等）は**起動時に検証で拒否**され、サーバーは起動しません。エラーメッセージに API キーなどの値は含まれません。

### リバースプロキシ配下での運用（`TRUST_PROXY`）

レート制限はクライアント IP（`req.ip`）単位で行われます。ロードバランサーやリバースプロキシ配下に置く場合、`TRUST_PROXY` を**前段プロキシの実台数**に設定してください（例: 単一の LB なら `1`）。

- `0`（既定）: プロキシを信頼せず、`X-Forwarded-For` を無視。直結環境で安全。
- 実台数より大きい値は設定しないでください。クライアントが `X-Forwarded-For` を偽装してレート制限を回避できるようになります。無条件の信頼（Express の `true`）は使用していません。

## 起動方法

### フロントエンド + バックエンドの同時起動

```bash
npm run dev
```

Windows PowerShell の場合:

```powershell
npm.cmd run dev
```

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:3001

### 個別起動

```bash
# フロントエンドのみ
npm run dev:frontend

# バックエンドのみ
npm run dev:backend
```

Windows PowerShell の場合:

```powershell
# フロントエンドのみ
npm.cmd run dev:frontend

# バックエンドのみ
npm.cmd run dev:backend
```

### ビルド

```bash
npm run build
```

Windows PowerShell の場合:

```powershell
npm.cmd run build
```

### ビルド後のバックエンド起動

```bash
npm run build:backend
npm run start:backend
```

Windows PowerShell の場合:

```powershell
npm.cmd run build:backend
npm.cmd run start:backend
```

### 型チェック

```bash
npm run typecheck
```

Windows PowerShell の場合:

```powershell
npm.cmd run typecheck
```

## 動作確認

バックエンドの起動後、ヘルスチェックエンドポイントで動作を確認できます。

```bash
curl http://localhost:3001/api/health
```

Windows PowerShell の場合:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

期待するレスポンス:

```json
{"status":"ok"}
```

`/api/stock/:ticker` は Phase 1 ではティッカーのバリデーションのみ行い、株価データ連携（Phase 2）が未実装のため `501 Not Implemented` を返します。

```bash
curl http://localhost:3001/api/stock/AAPL
# => 501 {"error":{"code":"NOT_IMPLEMENTED",...}}

curl http://localhost:3001/api/stock/INVALID!!!
# => 400 {"error":{"code":"INVALID_TICKER",...}}
```

### テスト

```bash
npm run test:run
```

Windows PowerShell の場合:

```powershell
npm.cmd run test:run
```

## API 仕様（Phase 1）

### 統一エラー契約

すべてのエラーは次の形式で返ります（`details` は開発環境でのみ付与され、test/production では除去されます）。

```json
{ "error": { "code": "<ERROR_CODE>", "message": "<人間可読メッセージ>" } }
```

| HTTP | code | 発生条件 |
|------|------|----------|
| 400 | `INVALID_TICKER` | ティッカー形式が不正 |
| 400 | `INVALID_JSON` | リクエストボディが不正な JSON |
| 403 | `FORBIDDEN_ORIGIN` | 許可されていない Origin からのアクセス |
| 404 | `NOT_FOUND` | 該当ルートなし |
| 413 | `PAYLOAD_TOO_LARGE` | リクエストボディが上限超過 |
| 429 | `RATE_LIMITED` | レート制限超過 |
| 500 | `INTERNAL_SERVER_ERROR` | 予期しないサーバーエラー（内部情報は非公開） |
| 501 | `NOT_IMPLEMENTED` | 未実装（Phase 1 の `/api/stock/:ticker`） |

予期しない例外は常に汎用 500 へ変換され、stack・内部パス・元の例外メッセージはクライアントへ返しません（production / development とも）。

### CORS 方針

- 許可リスト方式（`*` は不使用）。`ALLOWED_ORIGINS` に加え、本番以外でのみ `http://localhost:5173` を許可。
- Origin ヘッダーの無いリクエスト（curl・サーバー間・ヘルスチェック）は許可。
- 許可外 Origin は `403 FORBIDDEN_ORIGIN`（統一 JSON）。`Access-Control-Allow-Origin` は付与しません。
- Cookie / セッション認証を持たないため、`credentials` は無効です。

### レート制限

- `/api` 全体に基本リミッター、`/api/stock` にはより厳しいリミッターを適用（Phase 2 の外部 API 呼び出しに備える）。
- 全体リミッターは **JSON ボディパーサーより前**に適用されるため、不正 JSON・サイズ超過リクエストもレート制限の対象になります。
- 標準ヘッダーは IETF draft-7 形式（`express-rate-limit` の `standardHeaders: "draft-7"`）で、通常応答に結合形式の `RateLimit` と `RateLimit-Policy` を返します（個別の `RateLimit-Limit/Remaining/Reset` は draft-6 形式のため返しません）。
- 超過時は `429 RATE_LIMITED`（統一 JSON）に加え、`Retry-After`（秒）と上記 draft-7 ヘッダーを返します。
- **`/api/health` はレート制限の対象外**です。監視・死活監視の probe を絞らないための方針で、当エンドポイントは I/O もボディ解析も無い軽量な静的応答です。

### リクエストボディ

- JSON ボディの上限は **10KB**。超過時は `413 PAYLOAD_TOO_LARGE`、不正 JSON は `400 INVALID_JSON`。

### ティッカー形式（Phase 1）

- 1〜10 文字、ASCII 英数字と区切りの `.` / `-` のみ（例: `AAPL`, `BRK.B`, `BRK-B`, `BF.A`）。小文字は大文字へ正規化。
- ASCII 限定チェックを大文字変換の**前**に行うため、Unicode 互換文字（全角・`ſ`・`ı` 等）、制御文字、空白、パストラバーサルは拒否します。
- `RDS/A` のようなスラッシュを含む形式は **Phase 1 では非対応**です。Phase 2 で Alpha Vantage のシンボル仕様を確認したうえで再設計を検討します。

## npm scripts 一覧

| コマンド | 説明 |
|----------|------|
| `install:all` | root / frontend / backend の依存関係を一括インストール |
| `dev` | frontend + backend を同時に開発モードで起動 |
| `dev:frontend` | frontend のみ開発モードで起動 |
| `dev:backend` | backend のみ開発モードで起動 |
| `build` | frontend + backend をビルド |
| `build:frontend` | frontend のみビルド |
| `build:backend` | backend のみビルド |
| `start:backend` | backend のビルド成果物を Node.js で起動 |
| `typecheck` | frontend + backend の型チェック |
| `test` / `test:run` | backend のテスト（Vitest）を 1 回実行 |
| `test:backend` | backend のテストを実行 |

## プロジェクト構成

```
stock-insight-analyzer/
├── package.json          # ルート（npm scripts / concurrently）
├── .env.example          # 環境変数テンプレート
├── .gitignore
├── LICENSE               # MIT License
├── README.md
├── docs/
│   └── TASKS.md          # 開発タスク一覧
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx       # エントリーポイント
│       └── App.tsx        # ルートコンポーネント
└── backend/
    ├── package.json
    ├── tsconfig.json        # 型チェック用（src + tests）
    ├── tsconfig.build.json  # ビルド用（src のみ出力）
    ├── vitest.config.ts
    ├── src/
    │   ├── index.ts         # エントリーポイント（env 読込 + listen）
    │   ├── app.ts           # Express アプリ組立（CORS / helmet / ルーティング）
    │   ├── config/          # 環境変数の読込・バリデーション（zod）
    │   ├── middleware/      # エラーハンドラ / 404 / レート制限
    │   ├── routes/          # health / stock ルート
    │   ├── schemas/         # 入力バリデーションスキーマ（ティッカー）
    │   ├── types/           # ApiError・エラー契約型
    │   └── utils/           # asyncHandler 等
    └── tests/               # Vitest + Supertest によるテスト
```

## 現在未実装の機能

Phase 1（バックエンドAPI基盤）では、CORS 設定・セキュリティヘッダー（helmet）・入力バリデーション（ティッカー）・エラーハンドリング・テスト基盤（Vitest）を実装済みです。以下の機能は今後のPhaseで実装予定です。

- Alpha Vantage API との連携による株価データ取得
- FANG+ プリセット銘柄の選択 UI
- 個別銘柄のティッカー入力 UI
- テクニカル指標の計算（SMA, RSI, ボラティリティ等）
- 株価チャート表示
- 複数銘柄の比較テーブル
- 分析コメント生成
- 免責事項の UI 内表示
- CI/CD
- デプロイ設定

## 免責事項

本アプリは投資助言を目的としたものではありません。表示される分析結果やスコアは、過去の株価データに基づく参考情報であり、将来のパフォーマンスを予測・保証するものではありません。投資に関する最終判断はご自身の責任で行ってください。

## ライセンス

[MIT License](LICENSE)
