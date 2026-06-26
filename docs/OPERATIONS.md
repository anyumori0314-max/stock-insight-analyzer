# 運用ガイド (Operations) — Docker / バックアップ / スケジューリング / 障害復旧

Phase 21 の本番運用手順をまとめます。`Dockerfile` は **SPA と `/api` を 1 つの
コンテナで提供する単一公開イメージ**です（API のみを別オリジンで配信する構成は
`docs/DEPLOYMENT.md` を参照）。

すべてのデータ CLI（`data:import` / `data:backfill` / `data:daily` / `data:backup` /
`data:restore` / `ci:smoke`）は **実 API キー不要**で、`data:daily` の API 補完のみ
`STOCK_DATA_MODE=hybrid|live` かつキー設定時に外部通信します。それ以外は外部通信
ゼロです。

---

## 1. Docker

### イメージ構成（`Dockerfile`）

マルチステージ・**非 root 実行**。SPA と API を 1 プロセスで提供します。

1. **frontend** … Vite SPA を `frontend/dist` にビルド。
2. **build** … TypeScript backend を `dist/` にコンパイル（dev 依存込み）。
3. **deps** … 本番依存のみ `npm ci --omit=dev`（tsx/vitest/typescript を含めない）。
4. **runtime** … `node:22-bookworm-slim`。`dist/` ＋ 本番 `node_modules` ＋ SPA
   （`/app/public`）のみ。組み込み `node` 非特権ユーザーで起動し、永続データは
   `/data` ボリュームに分離。`STOCK_STATIC_DIR=/app/public` で SPA を配信します。

> Node 22.5+ が必要です（`node:sqlite` のため）。

### ビルドと起動

```bash
docker build -t stock-insight-analyzer .

# 最小構成（外部通信ゼロのモック）— ブラウザで http://localhost:3000 を開く
docker run --rm -p 3000:3000 -e STOCK_DATA_MODE=mock stock-insight-analyzer

# 本番相当（永続データを /data に保持。hybrid は実キー設定時のみ外部通信）
docker run --rm -p 3000:3000 \
  -e STOCK_DATA_MODE=hybrid \
  -e ALPHA_VANTAGE_API_KEY="$ALPHA_VANTAGE_API_KEY" \
  -v stock_data:/data \
  --name stock-insight-analyzer \
  stock-insight-analyzer
```

- **ポート**: 既定 `3000`（`-e PORT=...` で変更可。`EXPOSE 3000`）。SPA は同一
  オリジンの相対 `/api` を呼ぶため `VITE_API_BASE_URL` 不要・`ALLOWED_ORIGINS` 任意。
- **ルーティング**: `/api/*` は API、それ以外の GET は SPA の `index.html` に
  フォールバック（クライアントルーティング）。`/api` の未知パスは JSON 404 のまま、
  `/api/health`・`/api/ready` も SPA に奪われません。
- 永続データパス（既定）: `STOCK_DB_PATH=/data/history.sqlite`,
  `STOCK_CACHE_DIR=/data/stock-reports`, `STOCK_BACKUP_DIR=/data/backups`。`/data`
  のみ書込可能（`/app` は読み取り専用）。
- `HEALTHCHECK` は `PORT`（既定 3000）の `/api/health` を内部から叩きます（外部通信なし）。
- **秘密情報はイメージに焼かない**。`.dockerignore` が `.env*`（`.env.example` を除く）・
  実 DB・キャッシュ・ログ・ビルド成果物・`node_modules`/`dist` をコンテキストから除外
  します。キーは `-e` か Secrets/シークレットマウントで実行時に渡してください。

---

## 2. バックアップ（`data:backup`）

`VACUUM INTO` による**オンライン整合スナップショット**を取得し、世代管理で古い世代を
剪定します。アプリ稼働中でも安全です。

```bash
# 取得（既定の STOCK_BACKUP_DIR / STOCK_BACKUP_KEEP を使用）
npm run data:backup

# 取得せず計画だけ確認（作成名・剪定対象を表示）
npm run data:backup -- --dry-run

# 保存先と保持世代数を指定
npm run data:backup -- --backup-dir "/data/backups" --keep 14
```

- スナップショット名: `history-YYYYMMDD-HHMMSS.sqlite`（時刻順にソート）。
- `STOCK_BACKUP_KEEP`（既定 7）を超える古い世代は自動で削除されます。
- バックアップ先は**別ボリューム/別ホスト**を推奨（同一ディスク障害に備える）。

### スケジューリング

**Linux (cron)** — 毎日 02:30 にバックアップ:

```cron
30 2 * * * cd /opt/stock-insight && STOCK_DB_PATH=/data/history.sqlite \
  STOCK_BACKUP_DIR=/data/backups STOCK_BACKUP_KEEP=14 \
  /usr/bin/npm run data:backup >> /var/log/stock-backup.log 2>&1
```

Docker 内で実行する場合:

```cron
30 2 * * * docker exec stock-insight-backend npm run data:backup >> /var/log/stock-backup.log 2>&1
```

**Windows (Task Scheduler)** — PowerShell から登録:

```powershell
$action  = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "run data:backup" `
  -WorkingDirectory "C:\opt\stock-insight"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false
Register-ScheduledTask -TaskName "StockInsightBackup" -Action $action -Trigger $trigger `
  -Settings $settings -Description "Daily SQLite backup"
```

> 環境変数（`STOCK_DB_PATH` 等）はタスクの実行ユーザー環境、または `.env` で設定して
> ください。`-RunLevel Highest` は不要です（バックアップは非特権で動作します）。

---

## 3. リストア（`data:restore`）

ソースを**検証**（`integrity_check` + 実スキーマ確認）してから、**現行 DB を先に
スナップショット**（`pre-restore-*.sqlite`、復旧の取り消しに利用）し、検証済みスナップ
ショットを差し替え、不整合を生む `-wal` / `-shm` サイドカーを削除します。

```bash
# 利用可能なバックアップ一覧
npm run data:restore -- --list

# 計画のみ（検証はするが何も変更しない）
npm run data:restore -- --file history-20260101-023000.sqlite --dry-run

# 実行（現行 DB は pre-restore-* に退避してから差し替え）
npm run data:restore -- --file history-20260101-023000.sqlite
```

- `--file` はバックアップ名（`STOCK_BACKUP_DIR` 基準）を推奨。絶対パスも可ですが、
  **バックアップディレクトリ配下に限定**されます（外部パス・`..` での脱出・シンボリック
  リンク・現行 DB 自身は拒否）。
- 破損ファイル・非 SQLite・未マイグレーション DB・**現行より新しいスキーマ版**は
  **検証で拒否**され、現行 DB は変更されません。
- リストアは**アトミック**です: 一時ファイルへ複製し整合性確認 → アトミック rename で
  差し替え → `-wal`/`-shm`/`-journal` を除去。途中失敗時は一時ファイルを削除し、
  `pre-restore-*` から**自動ロールバック**します（現行 DB を破損状態で残しません）。

---

## 4. 日次運用（`data:daily`）

```bash
npm run data:daily                                   # CSV取込 + (hybrid/liveなら)API補完
npm run data:daily -- --csv-directory "/data/incoming"
npm run data:daily -- --tickers "AAPL,MSFT,NVDA"
```

- 二重起動防止ロック付き（`STOCK_DAILY_LOCK_TIMEOUT_SECONDS`）。
- 終了コード: `0` 正常 / `1` 入力エラー / `2` DB エラー / `3` 多重起動拒否。
- cron / Task Scheduler への登録は §2 と同じ要領です。

---

## 5. 障害復旧 (Disaster Recovery)

| 事象 | 対応 |
|------|------|
| DB 破損・データ消失 | `data:restore -- --list` → 最新の正常スナップショットを `--dry-run` で検証 → `--file` で復旧。直前状態は `pre-restore-*` に退避済み。 |
| リストア後に問題発覚 | `pre-restore-*` を `--file` に指定して再リストア（取り消し）。 |
| バックアップ自体が破損 | 検証で拒否される。1 つ前の世代を使用。`STOCK_BACKUP_KEEP` を十分大きく（例 14〜30）。 |
| 日次ロックが残留 | `STOCK_DAILY_LOCK_TIMEOUT_SECONDS` 経過後に自動回復。即時なら手動でロック行を削除。 |
| 外部 API 障害 | hybrid は SQLite にフォールバック（Provider fallback）。Circuit Breaker が連続失敗で即時遮断、cooldown 後に自動復帰。 |
| キー失効/未設定 | `/api/ready` が not_ready を返す。hybrid は SQLite で継続、live は `API_KEY_MISSING`（503）。 |

復旧後は必ず `/api/health`（liveness）と `/api/ready`（readiness：データモード・キー有無）
で確認してください。

---

## 6. 監視・セキュリティ（既存機構）

- **Health/Ready**: `/api/health`（プロセス生存）/ `/api/ready`（提供可否・データモード。
  外部 API は叩かない）。
- **セキュリティヘッダー**: helmet（CSP `default-src 'none'`、`Referrer-Policy`、本番
  HSTS、CORP、`Permissions-Policy`、`x-powered-by` 無効）。CORS は明示 allow-list。
- **structured logging**: 1 行 1 JSON。フラットなプリミティブのみ受け付け、スタックや
  プロバイダ生データは記録しない。
- **secret redaction**: ログのキー名が `apiKey/authorization/cookie/token/password/secret`
  等にマッチすると値を `[REDACTED]` に置換。制御文字除去・長さ上限あり。env 検証は
  値を出力しないため、API キーがログに漏れません。

### 6.1 CLI のパスとログ

- アプリ内部ログ・構造化ログは**ベース名のみ**（`sourceName` 等）。絶対パス・stack・
  行値は出力しません。想定外の例外も汎用メッセージに正規化し（`runCli`）、パスを含む
  生 stack を表示しません。
- **相対パス推奨**: `data:*` CLI には絶対パス（`C:\...`）より**相対パス**を渡すか、
  環境変数で指定してください（`STOCK_CSV_DIRECTORY` / `STOCK_DB_PATH` /
  `STOCK_BACKUP_DIR`、または `--backup-dir` / `--csv-directory`）。
- **既知の制約**: `npm run data:* -- --file C:\...` のように引数を渡すと、**npm 自身が
  実行コマンド行をエコー**するため絶対パスが端末に表示され得ます（アプリ側では抑止
  できません）。気になる場合は上記の相対パス／環境変数を使ってください。
```
