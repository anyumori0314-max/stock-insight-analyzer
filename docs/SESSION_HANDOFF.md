# セッション引き継ぎ（Session Handoff）

最終更新: 2026-06-21
ブランチ: `feature/stock-analysis-mvp`（Phase 2〜6 を**コミット済み**、`main` へ切替なし）

このドキュメントは、次回セッションで作業を再開するための引き継ぎメモです。**Phase 2〜6 の MVP 実装**、API 消費抑制対応、フロントエンドのライフサイクル修正、Provider・API 契約の厳格化、cache 保存順序の修正、README 整合までを実施し、追加コミットとして取り込み済みです。

---

## 1. Phase 2〜6 で完了した内容

### Phase 2: Alpha Vantage 連携
- `TIME_SERIES_DAILY`（`outputsize=compact`、直近約100営業日）クライアント。fetch 注入可・タイムアウト・エラー正規化。
- レスポンス分類順序: HTTP status → Content-Type 判定 → JSON parse → API エラー payload（`Error Message`/`Note`/`Information` を意味で個別分類）→ 件数上限の早期判定 → 成功 schema → cross-field 検証 → 正規化。
- Content-Type は `application/json` または `+json` サフィックスのみ JSON として処理（`application/notjson` 等の類似 MIME は拒否）。Content-Type 欠如は parse 許可。
- cross-field 検証: symbol 一致・日付実在・OHLC 整合（high≥low/open/close, low≤open/close）・volume 非負 safe integer・重複日付 dedup（warning）。不正行は payload 全体を拒否（サイレント補正なし）。空シリーズ → `INSUFFICIENT_DATA`。
- 価格/出来高の厳格数値化: 空文字・空白・null・boolean・`"123abc"`・`Infinity`・小数 volume などを拒否（`z.coerce` の 0 化を排除）。
- 件数上限は環境変数 `ALPHA_VANTAGE_MAX_POINTS`（既定 120・範囲 1〜10000）。`response.json()` 後・全件 Zod 変換前に件数とシリーズ形状を早期判定し、超過は `PROVIDER_RESPONSE_INVALID`（黙って切り捨てない）。
- 統一エラーコードは一元レジストリ（`ERROR_CATALOG`：code→status/message/retry 可否）＋`errorFor()` で管理: `API_KEY_MISSING`(503) / `API_KEY_INVALID`(401) / `PROVIDER_RATE_LIMITED`(429) / `PROVIDER_TIMEOUT`(504) / `PROVIDER_UNAVAILABLE`(502) / `PROVIDER_RESPONSE_INVALID`(502) / `SYMBOL_NOT_FOUND`(404) / `INSUFFICIENT_DATA`(422)。
- Provider 生メッセージ・URL・API キー・stack はクライアント/ログへ非公開。

### Phase 2: API 消費抑制
- **起動時の API 通信は 0 回**。初期表示は「銘柄を選択すると株価データを取得します。」の案内のみ。リロードや React StrictMode の effect 二重実行でも外部通信は発生しない。
- **選択した 1 銘柄だけ取得**。プリセット／タブ／個別追加の操作で対象 1 銘柄のみを取得し、比較表は取得済み銘柄のみ値を表示（未取得は「未取得」）。比較表が一括取得を起こさない。
- **API 制限時の自動再試行なし**。`PROVIDER_RATE_LIMITED` を受けても自動リトライ・タイマー・他銘柄への継続取得は行わず、共通エラーを画面上部に 1 件のみ表示（各行は「取得できませんでした」）。再試行はユーザーの明示操作のみで、処理中は再試行ボタンを無効化（連打不可）。
- **mock モード**: `STOCK_DATA_MODE=mock`（既定 `live`、本番では `mock` を起動時に拒否）。`MockStockDataProvider` を provider 層で注入し、**外部通信 0 回**で決定的なダミーデータを返す。レスポンスに `source` を付与し、UI に「開発用モックデータを表示しています。」と明示。
- **サーバー側 LRU キャッシュ**: `ticker:range` をキーに分析済みレポートを保持。TTL は `STOCK_CACHE_TTL_SECONDS`（既定 **6 時間**）、最大 `STOCK_CACHE_MAX_ENTRIES`（既定 **100 件**）、超過時は期限切れ → LRU の順に eviction。再起動で消えるインメモリ方式。
- **in-flight 重複排除**（backend）: 同一 `ticker:range` の並行リクエストを provider 1 回に集約。成功・失敗いずれも完了後にクリアし、失敗は再試行可。
- **公開 schema 検証を cache 保存前に実施**: source・cache metadata を付与した完成形を `assertPublicReport()` で検証し、**検証済みオブジェクトのみ**を `cache.set()`。不正レポートは保存されず、次回は cache hit せず Provider を再取得。

### Phase 3: フロントエンド UI 基盤
- 共有型はバックエンド契約を zod で mirror（`lib/reportSchema.ts`）。`response.json() as StockReport` は廃止し、**strict** ランタイム検証。
- `useStockReports` フック（遅延取得）: `request` / `refetch` / `forget` / `pending`。on-demand 取得・loading/success/error。
  - **ライフサイクル対策**: ticker 単位の `AbortController` 管理と generation ID により、(1) 削除時に通信を abort、(2) 削除後に遅れて返ったレスポンスを state へ反映しない、(3) unmount 後に state 更新しない、(4) 再追加時に古いレスポンスが復活しない、(5) retry 中の削除も abort。AbortError は UI エラーにしない。
  - **frontend in-flight 重複排除**: 同一 ticker の並行/連打要求は 1 回に集約。
- API クライアントに**クライアント側タイムアウト**（`VITE_API_TIMEOUT_MS`）。真の abort はユーザー向けエラーとして表示しない。
- FANG+ 参考プリセット・ティッカー入力（クライアント側検証）・デザイントークン CSS。

### Phase 4: テクニカル指標
- 現在値・前日比（`dailyChange` / `dailyChangePercent`）・期間騰落率・SMA20/50・RSI(14, Wilder)・年率ボラティリティ・最大下落率。
- **全公開数値の有限値保証**（`utils/number.ts` の `finiteOrNull`、NaN/Infinity は null 化）。

### Phase 5: チャート・比較表示
- Recharts による終値＋SMA20/50 チャート、複数銘柄比較テーブル、レスポンシブ。
- チャートに**読み上げ用テキスト要約**（priceBasis/currency/range/最新値/トレンド）。
- **通貨表示**: `currency` が null のとき通貨記号を付けず（USD を仮定しない）プレーン数値で表示。既知の通貨コード時のみ `Intl.NumberFormat` の通貨スタイル。比較表・指標パネル・チャートで統一。

### Phase 6: 分析コメント・免責
- トレンド/過熱感/リスク判定、**0〜100 到達可能**な「テクニカル状態スコア」（売買スコアではない旨の注記付き）、非助言の日本語コメント。
- 免責事項を README / API / UI で一貫化（raw close = 分割・配当調整前を明記）。

### API レスポンス契約（公開）
公開 `StockReport` は **strict**（未知フィールドを拒否）な zod 契約で、backend `schemas/report.ts` と frontend `lib/reportSchema.ts` の同一形で両端検証します。

- `source`: **必須**。`"live"`（Alpha Vantage）または `"mock"`（開発用ダミー）。default は持たず、欠落は検証失敗。
- `range`: `"100d"` 固定（literal）。MVP は単一ウィンドウのみ。service は range 引数を受けず、cache key は `ticker:100d`。
- `priceBasis`: 常に `"close"`、`adjustedClose`: 常に `null`（無料 `TIME_SERIES_DAILY` に調整後終値が無いため）。
- `currency`: `null` を許可。日次 payload だけで通貨を断定せず、**通貨不明時に USD を仮定しない**。
- 日付/日時は形式だけでなく**実在性**を検証（`series[].date`・`lastRefreshed`・`cache.expiresAt`。`2026-02-30` や `2026-99-99T99:99:99Z` を拒否）。
- フィールド: `{ ticker, source, range:"100d", currency, timezone, lastRefreshed, priceBasis:"close", series[](OHLCV+adjustedClose:null+sma20/50), metrics, analysis, warnings[], cache:{hit,expiresAt}, disclaimer }`。
- API 返却直前（cache 保存前）に公開 schema 検証を行い、違反は安全な `PROVIDER_RESPONSE_INVALID` に変換（内部 schema 詳細は非公開）。**不正レポートは cache へ保存しない**。

### アクセシビリティ
銘柄切替は WAI-ARIA タブ（tablist/tab/tabpanel・roving tabindex・矢印/Home/End）、loading=`role="status"`、error=`role="alert"`＋再試行、完了時にパネル見出しへ focus 移動、比較表の `caption`／削除ボタン `aria-label`、`.sr-only` ユーティリティ。

---

## 2. 変更した主要ファイル

### バックエンド（新規）
- `backend/src/utils/{number,dates}.ts`（finite ガード / 実在日付・日時検証）
- `backend/src/schemas/{report,alphaVantage}.ts`（公開契約 zod / provider 生レスポンス zod）
- `backend/src/services/{alphaVantageClient,ttlCache,stockService,mockStockDataProvider,providerErrorClassifier}.ts`
- `backend/src/analytics/{indicators,analysis,report}.ts`
- `backend/src/types/{report,stock,errors}.ts`（`ERROR_CATALOG`/`errorFor`、`StockRange="100d"` 等）
- backend テスト: `tests/{alphaVantageClient,alphaVantageSchema,ttlCache,stockService,indicators,analysis,report,reportSchema,dates,mockStockDataProvider,providerErrorClassifier,env,...}.test.ts`

### フロントエンド（新規）
- `frontend/vitest.config.ts`、`frontend/src/test/{setup,vitest.d,fixtures}.ts`
- `frontend/src/lib/{reportSchema,api,format,tickers,dates}.ts`
- `frontend/src/hooks/useStockReports.ts`
- `frontend/src/components/{Header,Sidebar,TickerTabs,MetricsPanel,PriceChart,AnalysisPanel,ComparisonTable,Disclaimer}.tsx`
- `frontend/src/styles/index.css`、`frontend/src/types/stock.ts`、`frontend/src/vite-env.d.ts`
- frontend テスト: `src/App.test.tsx`、`src/lib/{api,tickers,format,dates}.test.ts`、`src/hooks/useStockReports.test.ts`、`src/components/{Sidebar,MetricsPanel,PriceChart,AnalysisPanel,Disclaimer,ComparisonTable}.test.tsx`

### ルート / ドキュメント
- `package.json`（`test:run` を backend+frontend に）、`.env.example`（`STOCK_DATA_MODE`/`ALPHA_VANTAGE_MAX_POINTS`/`STOCK_CACHE_TTL_SECONDS` 等）、`.gitignore`（`.claude/` 追加）、`README.md`、`docs/TASKS.md`（Phase 2〜6 を `[x]`＋Provider/API 契約の追補節）

### 追加依存
- frontend `dependencies`: `zod`
- frontend `devDependencies`: `vitest` / `@testing-library/react` / `@testing-library/user-event` / `@testing-library/jest-dom` / `@testing-library/dom` / `jsdom`
- backend: 追加なし

---

## 3. テスト結果（直近実行）

| 検証 | 結果 |
|------|------|
| backend typecheck | ✅ 成功 |
| frontend typecheck | ✅ 成功 |
| backend テスト（Vitest+Supertest） | ✅ **273 件全パス**（20 ファイル） |
| frontend テスト（Vitest+RTL+jsdom） | ✅ **71 件全パス**（12 ファイル） |
| 合計 | ✅ **344 件全パス** |
| backend build / frontend build | ✅ EXIT 0 |
| npm audit（root / frontend / backend） | ✅ **0 件** |
| `git diff --check` | ✅ exit 0（`LF→CRLF` 情報警告のみ・無害） |

> 通常テストは外部ネットワークに接続しません（Alpha Vantage 呼び出しと `fetch` はすべてモック）。

---

## 4. 未実施の内容（意図的に未着手）

- **Phase 7 以降**（統合テスト拡充・セキュリティ総合確認・アクセシビリティ網羅・CI・デプロイ・公開ドキュメント・本番ビルド最適化/コード分割）。
- **push / PR 作成 / merge**（このコミット時点では未実施）。
- **実 Alpha Vantage への通信（実 API スモークテスト）**、および **実 API キーの設定**。
- 常駐サーバー（dev/start）の起動。

---

## 5. 残っている問題

1. **フロントのバンドルサイズ警告**: Recharts/zod により約 640KB（>500KB）。コード分割は Phase 8 最適化対象。
2. **実 API 未疎通**: 実レスポンスでの最終確認が未実施。Provider advisory の分類は `classifyProviderMessage()` による文言ヒューリスティック（API キー/entitlement・rate limit・銘柄・障害を内容で判定）のため、実データでの確認が望ましい。
3. **frontend テストは代表ケース中心**: カテゴリ網羅だが全 bullet の完全網羅ではない。
4. **Git のグローバル ignore 設定に関する警告**: 環境によっては Git のグローバル ignore（ユーザー環境の global excludes file）に関する警告が出る場合があります。これはリポジトリ外のグローバル設定に起因し、本リポジトリの追跡には影響しません。Claude Code からは変更していません。必要に応じて参照先を確認してください（`git config --global --get core.excludesFile`）。

---

## 6. 次に行うべき作業（再開時の選択肢）

1. **Codex 再レビュー**に渡す（観点: in-flight dedup＋LRU＋期限切れ優先の境界 / provider 分類と生情報非公開 / 公開 schema strict・source 必須・range 固定・実在日付検証 / cache 保存前検証の妥当性 / ライフサイクル（abort/generation/unmount/StrictMode）の網羅性 / 通貨表示・免責の一貫性）。
2. **実 API スモークテスト（手動）**: `.env` に `STOCK_DATA_MODE=live` と `ALPHA_VANTAGE_API_KEY` を設定 → `npm run dev:backend` → `curl http://localhost:3001/api/stock/AAPL` で疎通確認（自動テストとは分離・最小限）。
3. **push / PR 作成**の判断（下記参照）。
4. **Phase 7 着手**（テスト網羅・セキュリティ・アクセシビリティ・CI 等）。

---

## 7. commit・push の状態（重要）

- **コミット済み**: Phase 2〜6 一式を 1 コミットに取り込み済みです。
  - HEAD: `b246445` — `feat: implement stock analysis MVP phases 2 through 6`
  - working tree は本ドキュメント修正の開始前時点で clean。
- `origin/feature/stock-analysis-mvp` より **1 コミット先行**（このコミットは未 push）。
- **push / PR 作成 / merge は未実施**。`main` へは切り替えていません（`main` に対しては Phase 2〜6 全体が未反映）。
- `.env` / `.claude/settings.local.json` / `node_modules` / `dist` は追跡対象外（gitignore 済み）。機密（API キー・トークン・Provider 生レスポンス・ローカル絶対パス）はコミットに含まれていません。
- 再開時は `git status` / `git log --oneline -3` で現状を確認し、push 可否を判断してから進めてください。

---

## 関連ドキュメント
- `docs/TASKS.md` … Phase 別タスク一覧（Phase 2〜6 は `[x]`、Provider/API 契約の追補節あり、Phase 7 以降は未チェック）
- `README.md` … 実装済み機能・環境変数・API 契約・エラーコード・キャッシュ・免責・テストコマンド
