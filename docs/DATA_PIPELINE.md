# データパイプライン（Phase 12〜15）

CSV → SQLite（履歴株価の正本）→ 不足営業日の API 補完 → 分析 → 画面のデータ状態表示、
までの基盤を説明します。CSV 仕様は [CSV_FORMAT.md](CSV_FORMAT.md) を参照してください。

## 概要

- **Phase 12**: CSV を検証して SQLite へ**冪等に**保存（履歴株価の正本）。
- **Phase 13**: SQLite を優先し、**不足営業日があるときだけ** Provider（Alpha Vantage）から
  最新日足を取得して**新しい日付だけ**保存。
- **Phase 14**: 日次バッチ（二重起動防止・障害復旧・Windows Task Scheduler 手順）。
- **Phase 15**: 取得元・最新取引日・更新状態・stale / fallback を画面に表示。

## データフロー

```
            ┌──────────┐   import    ┌─────────────────────┐
  CSV files │  *.csv   │ ─────────▶ │ CsvImportService     │
            └──────────┘  validate   │  (全件検証→TX→UPSERT)│
                                     └─────────┬───────────┘
                                               ▼
        ┌──────────────────────────── SQLite（正本）────────────────────────────┐
        │  price_bars / import_runs / sync_state / job_locks / schema_migrations │
        └───────┬───────────────────────────────────────────────────┬───────────┘
                │ read (historical/hybrid)                            │ upsert (api)
                ▼                                                     ▲
   HistoricalDataService ──▶ StockService ──▶ /api/stock/:ticker      │
                                  ▲                                   │
                                  │ hybrid: 不足時のみ 1 回           │
                                  └──── MarketDataSyncService ───▶ AlphaVantageProvider
```

リクエスト経路にビジネスロジックを置かず、route は入力検証・service 呼出し・公開レスポンス
変換のみを担当します（CSV 解析・DB 操作・API 補完・バッチ制御・UI 表示を分離）。

| レイヤー | 主な構成 |
|----------|----------|
| Domain | `PriceBar` / `ImportRun` / `SyncState` / `DataFreshness` / `DataSourceMetadata` |
| Repository | `PriceRepository` / `ImportRunRepository` / `SyncStateRepository` / migrations |
| Service | `CsvImportService` / `HistoricalDataService` / `MarketDataSyncService` / `DailyUpdateService` / `DataFreshnessService` |
| Provider | `AlphaVantageProvider`(client) / `MockProvider` / SQLite 読取（HistoricalDataService）/ CSV 取込（CsvImportService）|
| Controller | 既存 `/api/stock`、`/api/health`・`/api/ready` |

## SQLite スキーマ概要

> ライブラリは Node 標準の **`node:sqlite`（`DatabaseSync`）**。ネイティブビルド不要・追加
> 依存なし・Windows ARM 可。実験的 API のため **Node ≥ 22.5** が必要で、初回利用時に
> ExperimentalWarning を出します。`mock`/`live` はこのモジュールを読み込みません。

| テーブル | 役割 | 主キー / 主な制約 |
|----------|------|-------------------|
| `price_bars` | 日足の正本 | PK `(ticker, trade_date)`、価格は正・`high ≥ low`、`volume ≥ 0`、`source ∈ {csv,api,mock}`、`trade_date` index |
| `import_runs` | 取込/同期の実行履歴 | `status ∈ {started,completed,failed}`、行数カウント、`safe_error_summary`（安全な要約のみ） |
| `sync_state` | ティッカー別の同期状態 | PK `ticker`、`last_result ∈ {success,skipped,failed,no_data}`、`last_error_code` / `safe_error_message` |
| `job_locks` | 日次ジョブの排他制御 | PK `name`、`owner` / `run_id` / `acquired_at` / `expires_at` |
| `schema_migrations` | マイグレーション版数 | PK `version`、`applied_at` |

- マイグレーションは前方専用・冪等（再実行しても壊れない）。DB 作成前に親ディレクトリを安全に作成。
- UPSERT は `(ticker, trade_date)` 単位。同一 CSV / 同一 API データを再処理しても重複しません。
- 書込はトランザクション。検証失敗・途中失敗時はロールバックし、既存データを破壊しません。

## データモード

| モード | データ源 | 外部通信 | SQLite |
|--------|----------|----------|--------|
| `mock` | 決定的な擬似データ | **0 回** | 使わない（保存もしない） |
| `historical` | SQLite のみ | **0 回** | 読取のみ |
| `hybrid` | SQLite 優先＋不足時のみ API | **不足時のみ最大 1 回/銘柄** | 読取＋（補完時）UPSERT |
| `live` | Alpha Vantage 直接（従来） | リクエスト毎（キャッシュ有） | 使わない |

`hybrid` の挙動: SQLite を優先し、不足があるときだけ Provider を 1 回呼び、**SQLite に無い
新しい日付だけ** UPSERT します。Provider 失敗時は **保存済み SQLite データを返し**（fallback）、
既存データが全く無い場合のみ安全なエラーを返します。

### API 通信が発生する条件（`hybrid`）

すべて満たすときのみ、**対象ティッカー 1 件につき最大 1 回**:

1. 利用者がそのティッカーを選択した（起動時・初期表示では発生しない）。
2. SQLite の最新 `trade_date` が直近の**確定**営業日より古い。
3. 直近 `STOCK_STALE_AFTER_HOURS`（既定 24h）に同期試行がない。
4. 実 API キーが設定されている。

同一ティッカーの並行リクエストは 1 回に集約（in-flight dedup）します。

### API 通信が発生しない条件

- 起動時 / 画面初期表示 / ティッカー未選択。
- `mock` / `historical`。
- SQLite が十分新しい / 同日に試行済み。
- レート制限・タイムアウト後（**自動再試行はしません**）。
- キー未設定の `hybrid`（SQLite のみを返す）。

### Alpha Vantage は単一日取得ではない

日次 API（`TIME_SERIES_DAILY`, `outputsize=compact`）は最新 ~100 営業日を返します。本基盤は
「当日分だけ取得」ではなく、**最新レスポンスから SQLite より新しい日付だけを抽出して保存**します。
最新営業日は過剰に断定せず、最終的には **Provider レスポンスの日付を正**とします（営業日判定は
週末・主要休場日のみの簡易カレンダーで、配信遅延を見込んで保守的に判断します）。

## CSV 取込

```bash
npm run data:import -- --file "<CSV_PATH>"
npm run data:import -- --directory "<CSV_DIRECTORY>"
```

詳細・終了コードは [CSV_FORMAT.md](CSV_FORMAT.md) を参照。

## 日次バッチ

```bash
npm run data:daily
npm run data:daily -- --csv-directory "<DIR>"
npm run data:daily -- --tickers "AAPL,MSFT,NVDA"
```

処理順: 環境検証 → 二重起動確認（DB job lock）→ CSV 取込 → 整合性確認 → 不足日判定 →
（キーがあれば）API 補完 → 結果記録（`import_runs` / `sync_state`）→ 安全に終了。分析データは
リクエスト時に SQLite から都度算出するため、別途の再構築は不要です。

終了コード: `0`=成功 / `1`=入力エラー / `2`=DB エラー / `3`=二重起動で拒否。

- **二重起動防止**: `job_locks` を `BEGIN IMMEDIATE` 内で取得。所有者・開始時刻・実行 ID を記録。
- **障害復旧**: lock には `expires_at` があり、期限切れ（異常終了の置き土産）は再取得可能。
  永久 lock は残りません。CSV 検証失敗時は DB 無変更、API 失敗は銘柄ごとに記録して続行。

### Windows Task Scheduler

実行スクリプト: `scripts/run-daily-stock-update.ps1`（プロジェクトルートを自動解決、実 API キーを
直書きしない、`.env` の内容を表示しない、ログ出力先を設定可能、終了コードを維持、グローバル
mutex で多重起動を抑止）。

登録例（**この手順は自動実行しません。手動で登録してください**）。毎営業日 18:30 に実行する例:

```powershell
schtasks /Create /TN "StockInsightDailyUpdate" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 18:30 ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\path\to\stock-insight-analyzer\scripts\run-daily-stock-update.ps1\" -Tickers \"AAPL,MSFT,NVDA\"" ^
  /RL LIMITED /F
```

ログは既定で `<project>\.cache\logs\daily-stock-update-YYYYMMDD.log`（git 無視）に出力します。

## バックアップ・削除・復旧

- **バックアップ**: バッチ停止中に `STOCK_DB_PATH` の `*.sqlite` と `-wal`/`-shm` をコピー
  （実行中はチェックポイント後に取得）。
- **DB 削除の影響**: 履歴株価の正本が失われます。`historical` はデータ無し（安全な 422）に、
  `hybrid` は次回アクセス時に Provider から再取得して再構築します（キーが必要）。CSV を保管して
  いれば `data:import` で再構築できます。`mock`/`live` は DB に依存しないため影響を受けません。
- **障害復旧**: 失敗した取込/同期は `import_runs` / `sync_state` に安全な要約のみ記録され、
  手動で再実行できます（冪等）。古い lock は自動的に再取得可能。

## ログ確認

構造化ログ（1 行 1 JSON）。主なイベント: `csv_import_started/completed/failed`,
`sync_started/skipped/completed/failed`, `daily_job_started/completed/failed`,
`concurrent_job_rejected`。含めてよいのは runId / ticker / 行数 / 経過時間 / 公開エラーコード。

**含めない**: API キー・Authorization・Provider 本文・stack・ローカル絶対パス・CSV 全内容・個人情報。
logger はキー名に秘密語を含むフィールドを自動で `[REDACTED]` にし、制御文字を除去します。

## 秘密情報・コミット禁止物

- 実 API キー・`.env`・実 SQLite DB（`*.sqlite`/`-wal`/`-shm`）・実 CSV はコミットしません
  （`.gitignore` 済み）。テストには最小 fixture のみをインラインで置きます。

## Phase 16 以降（未実装）

- 6か月・1年対応（`outputsize=full`）、過去日の歯抜けバックフィル、複数プロバイダ、
  ウォッチリストの永続化、CI 整備。
