# デプロイ & 運用手順書 (Deployment & Operations Runbook)

Stock Insight Analyzer を公開するための構成・手順と、運用時の対応手順をまとめる。
対象は **backend (Express API)** と **frontend (Vite SPA)** を別々にビルド・配信する構成。

---

## 1. アーキテクチャ概要

```
[Browser] --HTTPS--> [Frontend SPA (静的配信)] --/api--> [Backend API (Express)] --HTTPS--> [Alpha Vantage]
```

- **frontend** は `vite build` で静的アセット (`frontend/dist`) を生成し、CDN / 静的ホスティングへ配置する。
- **backend** は `node dist/index.js` で起動する JSON 専用 API。SPA は配信しない（CSP は `default-src 'none'`）。
- 両者は **別オリジン**。ブラウザからの呼び出しは CORS allow-list（後述）で制御する。
- Alpha Vantage の API キーは **backend のみ** が保持し、フロントには一切渡らない。

---

## 2. 環境変数

backend は起動時に `loadEnv()`（`backend/src/config/env.ts`）で全変数を検証する。
不正値は **起動失敗**（変数名とメッセージのみ出力、受領値は伏せる）。

### Backend（ルート `.env`。`.env.example` を複製して作成）

| 変数 | 必須 | 既定 | 説明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 推奨 | `development` | `production` で HSTS 有効・dev オリジン無効・`mock` 禁止 |
| `PORT` | - | `3001` | 待受ポート |
| `TRUST_PROXY` | 本番推奨 | `0` | 信頼するリバースプロキシ段数。実段数を超えて設定しない |
| `ALLOWED_ORIGINS` | 本番必須 | （空） | SPA オリジンをカンマ区切りで。`*` は不可 |
| `STOCK_DATA_MODE` | - | `live` | `live`/`mock`。本番で `mock` は起動失敗 |
| `ALPHA_VANTAGE_API_KEY` | live時 | （空） | live モードの API キー。未設定でも起動はするが `/api/ready` が `not_ready`(503) を返し、株価リクエストは 503 `API_KEY_MISSING` |
| `ALPHA_VANTAGE_TIMEOUT_MS` | - | `8000` | 外部呼び出しタイムアウト (1000–30000) |
| `ALPHA_VANTAGE_MAX_POINTS` | - | `120` | 受理する日次データ点数の上限 |
| `STOCK_CACHE_MAX_ENTRIES` | - | `100` | キャッシュ最大件数（メモリ/永続共通、LRU） |
| `STOCK_CACHE_TTL_SECONDS` | - | `21600` | キャッシュ TTL 秒 (1–86400) |
| `STOCK_CACHE_DIR` | - | `.cache/stock-reports` | 永続キャッシュ保存先。`ticker:range:dataMode` 単位で保存し live/mock を分離。本番は書込可能な永続ボリュームへ |

> **対応期間**: 無料の `TIME_SERIES_DAILY`（compact、約100営業日）で誠実に提供できる **1か月 / 3か月のみ**を公開。6か月・1年は未対応で API は `400 INVALID_RANGE` を返す。

### Frontend（`frontend/.env*`。`frontend/.env.example` 参照）

| 変数 | 必須 | 既定 | 説明 |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | 本番必須 | （空） | backend のベース URL。開発時は空（Vite proxy 利用） |
| `VITE_API_TIMEOUT_MS` | - | `10000` | クライアント側タイムアウト ms |

> `VITE_*` は**ビルド時にバンドルへ展開され公開される**。秘密情報を置かないこと。

---

## 3. ビルドと起動

```bash
# 依存関係（初回）
npm run install:all

# 検証（CI 必須）
npm run typecheck
npm run test:run
npm run build           # frontend + backend を両方ビルド

# 本番起動（backend）
NODE_ENV=production node backend/dist/index.js

# frontend は backend/dist とは別に静的配信
#   frontend/dist/ を CDN / Nginx / 静的ホスティングへ配置
```

backend は `backend/dist/index.js`、frontend は `frontend/dist/` が成果物。
どちらも Git 追跡対象外（`dist/` は `.gitignore` 済み）。

---

## 4. セキュリティ

- **CORS**: `ALLOWED_ORIGINS` の許可リスト方式。許可外オリジンは 403 `FORBIDDEN_ORIGIN`。`*` 不使用。Origin ヘッダ無し（curl/同一オリジン/監視）は許可。
- **セキュリティヘッダ (helmet)**: CSP `default-src 'none'`、`frame-ancestors 'none'`、`base-uri 'none'`、`Referrer-Policy: no-referrer`、`Permissions-Policy` で不要機能を全拒否、本番のみ HSTS（180日, includeSubDomains）。
- **レート制限**: `/api` 全体 + `/api/stock` の二段。body parser より前に適用し、不正/過大 body も制限対象。
- **秘密情報**: API キーは backend のみ。`.env` は Git 追跡外（`!.env.example` のみ許可）。ログ・エラー・永続キャッシュにキーや provider 生レスポンスを書かない。

### 4.1 フロントエンド（SPA）配信側のヘッダ

> **重要**: backend は **JSON 専用 API** で SPA の HTML を配信しない（CSP `default-src 'none'`）。したがって **SPA の HTML は backend の helmet では保護されない**。`frontend/dist` を配信する CDN / 静的ホスティング側で以下を必ず付与すること。

付与すべきヘッダ（SPA 向け）:

- `Content-Security-Policy`: 例
  `default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`
  （`connect-src` は実際の API オリジン = `VITE_API_BASE_URL` に合わせる）
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()`
- HTTPS では `Strict-Transport-Security: max-age=15552000; includeSubDomains`

配信側設定例:

```nginx
# Nginx (静的配信 server ブロック内)
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=(), payment=(), usb=()" always;
add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
```

```toml
# Netlify (netlify.toml)
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "no-referrer"
    Permissions-Policy = "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
```

```json
// Vercel (vercel.json)
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Permissions-Policy", "value": "geolocation=(), camera=(), microphone=(), payment=(), usb=()" }
      ]
    }
  ]
}
```

- **CDN（CloudFront 等）**: Response Headers Policy で同等のヘッダを付与。
- **CORS**: 株価 API 側は backend の `ALLOWED_ORIGINS` 許可リストで制御（`*` 不可）。SPA 静的アセットは同一オリジン配信なら CORS 不要。

---

## 5. 監視 — Health / Readiness

| エンドポイント | 用途 | 内容 |
| --- | --- | --- |
| `GET /api/health` | **Liveness**（プロセス生存） | 静的 JSON の軽量 200。レート制限・body parser・provider 通信を通さない |
| `GET /api/ready` | **Readiness**（受理可能性） | 稼働データモード等を返す。設定不備（`live` で API キー未設定など）では **503 `not_ready`** と安全なタグ（例 `alpha_vantage_api_key_missing`、**キー値は含めない**）を返す。Alpha Vantage へは触れない |

- すべての応答に相関 ID `X-Request-Id` が付与され、1 リクエスト 1 ログ（構造化、event=`http.request`）を出力する。
- ログには **API キー・provider 本文・クエリ文字列・stack・ローカル絶対パス**を出さない方針（予期しない例外も生 Error をそのまま出力せず安全なフィールドのみ）。

監視設定の目安:
- Liveness プローブ: `/api/health` を 10–30s 間隔。失敗継続で再起動。
- Readiness プローブ: `/api/ready` を 10–30s 間隔。失敗時はロードバランサから除外。

---

## 6. 運用手順（Runbook）

### 6.1 Alpha Vantage 障害・レート超過時
症状: `/api/stock` が 429 / 503（`PROVIDER_RATE_LIMITED` / `PROVIDER_UNAVAILABLE` / `PROVIDER_TIMEOUT`）。
1. `/api/ready` で `dataMode` を確認。
2. ログの `http.request`（errorCode 付き）失敗率と相関 ID を確認（キー・本文は出ない）。
3. 一時的なら TTL キャッシュが既存銘柄を吸収。恒常的なら Alpha Vantage の稼働/プラン枠を確認。
4. 緊急回避としてステージングのみ `STOCK_DATA_MODE=mock` で UI 確認可（**本番は不可**）。

### 6.2 API キー未設定 / 不正
症状: 503 `API_KEY_MISSING` / `API_KEY_INVALID`。
1. backend 環境の `ALPHA_VANTAGE_API_KEY` を確認（値はログに出ない）。
2. 修正後は再起動して反映。フロントには影響を波及させない（友好的メッセージ表示のみ）。

### 6.3 永続キャッシュの運用
- 2 層構成: **メモリ層**（再起動で消える）＋ **ディスク層**（`STOCK_CACHE_DIR`、再起動後も再利用）。
- 保存先 `STOCK_CACHE_DIR`。書込不可（read-only/full disk）でも **メモリのみへ自動降格**し、リクエストは失敗しない（`cache.persist.failed` を warn）。書込は atomic（temp→rename）。
- **live/mock 分離**: エントリは `ticker:range:dataMode` 単位で保存し、ファイル名とメタデータに `dataMode` を記録。実行モードと一致しないエントリ、または保存 `source` と `dataMode` が矛盾するエントリは **読込時にクリーンミス扱いで削除**（mock データが `source:"live"` として公開されない）。
- **LRU**: ディスク層は**最終アクセス時刻**で真の LRU eviction（読込でアクセス時刻を更新するため、よく読まれるエントリが書込順だけで削除されない）。eviction は期限切れを優先削除。
- スキーマ変更時は `STOCK_REPORT_CACHE_SCHEMA_VERSION` を bump → 旧エントリ（旧 schema）は読込時に無効化・削除。
- 破損 JSON / 期限切れ / キー不一致 / schema 不一致は読込時に削除。ヒット時も公開 schema を再検証してから提供。手動介入不要。
- 完全リセットが必要なら `STOCK_CACHE_DIR` を削除して再起動（次回 miss から再構築）。

### 6.6 履歴データ基盤（Phase 12〜15）の運用
- **データモード** `STOCK_DATA_MODE`: `mock`（外部通信 0・DB なし）/ `historical`（SQLite のみ）/ `hybrid`（SQLite 優先＋不足時のみ API 補完、失敗時 fallback）/ `live`（従来）。詳細は **[DATA_PIPELINE.md](DATA_PIPELINE.md)**。
- **Node 要件**: プロジェクト全体で **Node ≥ 22.5**（`engines.node` を root / backend / frontend で `>=22.5.0` に統一）。`historical`/`hybrid` と データ CLI（CSV 取込・日次バッチ）が標準 `node:sqlite` を使い、これが Node ≥ 22.5 を要求するため（ネイティブビルド不要・追加依存なし・Windows ARM 可）。`mock`/`live` のコードパス自体は Node ≥ 20.19 でも動くが、運用時は統一要件の 22.5 以上を満たすこと。
- **DB ボリューム**: `STOCK_DB_PATH`（既定 `.cache/stock-data/history.sqlite`）は**書込可能な永続ボリューム**へ。DB と `-wal`/`-shm` は git 無視。実 DB はコミットしない。
- **CSV 取込**: `npm run data:import -- --file/--directory ...`。仕様は **[CSV_FORMAT.md](CSV_FORMAT.md)**。実 CSV はコミットしない。
- **日次バッチ**: `npm run data:daily`。Windows は `scripts/run-daily-stock-update.ps1` を Task Scheduler に**手動**登録（`schtasks` 例は DATA_PIPELINE.md）。二重起動は DB job lock で防止、異常終了後も永久 lock は残らない。
- **バックアップ/復旧**: バッチ停止中に DB をコピー。DB 削除時は `historical` がデータ無し（422）、`hybrid` は再取得で再構築、CSV からも再構築可。`mock`/`live` は無影響。
- **秘密情報**: ログ・レスポンス・DB に API キー/本文/stack/絶対パスを出さない。

### 6.5 既知の制限
- **ウォッチリストの永続化は未実装**（選択銘柄はリロードで失われる。今回も対象外）。
- **mock / 営業日カレンダーは完全な取引所カレンダーではない**（主要な全日休場のみ。早朝引け・臨時休場は対象外）。最新営業日は Provider レスポンスの日付を正とする。本番では `mock` 不可。
- **Recharts は遅延ロード**（チャート表示時のみ取得）。SPA の初期表示には含まれない。

### 6.4 グレースフルシャットダウン
- `SIGINT`/`SIGTERM` で in-flight を drain → 完了後終了。停滞時は強制終了。重複シグナルは無視。
- デプロイ時はプロセスに上記シグナルを送り、ヘルスチェック除外 → 排出 → 入替の順で実施。

---

## 7. リリース前チェックリスト

- [ ] `npm run typecheck` / `npm run test:run` / `npm run build` が緑
- [ ] `npm audit`（root / frontend / backend）に高危険度なし
- [ ] `.env` がコミットに含まれない（`git status` で確認）
- [ ] 本番 `NODE_ENV=production`・`ALLOWED_ORIGINS` 設定・`STOCK_DATA_MODE=live`
- [ ] `VITE_API_BASE_URL` が本番 API を指す
- [ ] `/api/health` と `/api/ready` が監視に登録済み
- [ ] `STOCK_CACHE_DIR` が書込可能な永続ボリューム
- [ ] `historical`/`hybrid` 運用時: Node ≥ 22.5、`STOCK_DB_PATH` が永続ボリューム、実 DB/CSV が未コミット
- [ ] 日次バッチを使う場合: `scripts/run-daily-stock-update.ps1` を Task Scheduler に登録済み
