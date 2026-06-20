# Stock Insight Analyzer

FANG+や個別米国株の株価データを取得し、投資判断の参考になる分析情報をダッシュボード形式で表示するWebアプリです。

> **開発状況**: 本プロジェクトは現在開発中です。現時点ではプロジェクトの初期構成のみが完了しており、株価データの取得や分析機能はまだ実装されていません。

> **免責事項**: 本アプリは特定銘柄の売買を推奨するものではなく、投資助言を目的としたものでもありません。表示される情報は過去の株価データに基づく参考情報であり、将来のパフォーマンスを予測・保証するものではありません。投資に関する最終判断はご自身の責任で行ってください。

## 技術構成

| 領域 | 技術 |
|------|------|
| フロントエンド | React + TypeScript (Vite) |
| バックエンド | Express + TypeScript |
| 株価データ | Alpha Vantage API |
| パッケージ管理 | npm |
| ランタイム | Node.js 18+ |

## 必要環境

- Node.js 18 以上
- npm 9 以上
- Alpha Vantage API キー（[無料取得](https://www.alphavantage.co/support/#api-key)、Phase 2 以降で必要）

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
ALPHA_VANTAGE_API_KEY=your_api_key_here
PORT=3001
```

> **重要**: `.env` ファイルには API キーなどの機密情報が含まれます。`.env` は `.gitignore` で除外されていますが、**絶対に Git にコミットしないでください**。コミット前に `git status` で `.env` が含まれていないことを確認してください。

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API のキー（Phase 2 以降で必要） | なし |
| `PORT` | バックエンドサーバーのポート番号 | `3001` |

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
    ├── tsconfig.json
    └── src/
        └── index.ts       # Express サーバー
```

## 現在未実装の機能

以下の機能は今後のPhaseで実装予定です。

- Alpha Vantage API との連携による株価データ取得
- FANG+ プリセット銘柄の選択 UI
- 個別銘柄のティッカー入力 UI
- テクニカル指標の計算（SMA, RSI, ボラティリティ等）
- 株価チャート表示
- 複数銘柄の比較テーブル
- 分析コメント生成
- 免責事項の UI 内表示
- CORS 設定
- セキュリティヘッダー
- 入力バリデーション
- テストフレームワーク
- CI/CD
- デプロイ設定

## 免責事項

本アプリは投資助言を目的としたものではありません。表示される分析結果やスコアは、過去の株価データに基づく参考情報であり、将来のパフォーマンスを予測・保証するものではありません。投資に関する最終判断はご自身の責任で行ってください。

## ライセンス

[MIT License](LICENSE)
