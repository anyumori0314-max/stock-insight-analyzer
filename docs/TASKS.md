# 開発タスク一覧

## Phase 0: プロジェクト初期構成

- [x] React + TypeScript + Express の最小構成を作成
- [x] frontend / backend の基本構成を作成
- [x] root / frontend / backend の package.json を作成
- [x] npm scripts を整備
- [x] .env.example を作成
- [x] .gitignore を作成
- [x] README.md にセットアップ手順を記載
- [x] docs/TASKS.md に開発予定を記載
- [x] /api/health エンドポイントの実装

## Phase 0.5: 初期構成の修正・固定

- [x] Git ブランチ名を main に変更
- [x] .gitignore の補強（*.tsbuildinfo, coverage/, .env.* 対応）
- [x] MIT LICENSE ファイルの作成
- [x] dotenv の読み込みパスを path.resolve に修正
- [x] backend のモジュール方式を確認・CJS で統一
- [x] Express 関連依存の整合性を確認
- [x] npm scripts の整理（typecheck, start:backend 追加）
- [x] README.md を公開前提で全面整備
- [x] TASKS.md を Phase 0〜9 構成に更新

## Phase 1: バックエンドAPI基盤

- [ ] 環境変数の一元管理（src/config.ts）とバリデーション
- [ ] CORS 設定
- [ ] セキュリティヘッダー（helmet）の導入
- [ ] エラーハンドリングミドルウェアの実装
- [ ] /api/stock/:ticker ルートのスケルトン作成
- [ ] 入力バリデーション（zod によるティッカーバリデーション）
- [ ] テスト環境の構築（Vitest）
- [ ] /api/health および新規エンドポイントのテスト

## Phase 2: Alpha Vantage 連携

- [ ] Alpha Vantage API クライアントの作成
- [ ] 日次株価データ（TIME_SERIES_DAILY）の取得
- [ ] API レスポンスの型定義と検証
- [ ] API レート制限対策（サーバー側キャッシュ）
- [ ] タイムアウト処理
- [ ] エラー時のフォールバック
- [ ] Alpha Vantage モジュールのテスト（モック使用）

## Phase 3: フロントエンド UI 基盤

- [ ] グローバル CSS / デザイントークンの設定
- [ ] レイアウトコンポーネント（Header, Sidebar, Main）の実装
- [ ] FANG+ プリセット銘柄の選択 UI
- [ ] 個別銘柄のティッカー入力 UI（クライアント側バリデーション）
- [ ] useStockData hook（API 通信 + ローディング + エラー）の実装
- [ ] 共有型定義（types/stock.ts）の作成

## Phase 4: テクニカル指標の計算

- [ ] 現在価格・期間騰落率の計算
- [ ] 移動平均（SMA20, SMA50）の計算
- [ ] RSI（14日）の計算
- [ ] ボラティリティ（年率換算）の計算
- [ ] 最大下落率（Maximum Drawdown）の計算
- [ ] 各指標の計算ロジックのユニットテスト

## Phase 5: チャート・比較表示

- [ ] チャートライブラリ（Recharts）の導入
- [ ] 株価チャート（終値）の表示
- [ ] 20日・50日移動平均線の表示
- [ ] 複数銘柄の比較テーブル表示
- [ ] レスポンシブ対応

## Phase 6: 分析コメント・免責表示

- [ ] トレンド判定（移動平均との位置関係）
- [ ] 過熱感判定（RSI 基準）
- [ ] リスク判定（ボラティリティ・最大下落率基準）
- [ ] 総合評価スコアの算出
- [ ] ルールベースの分析コメント生成
- [ ] 免責事項コンポーネント（フッター常時表示）
- [ ] 投資助言に見える表現の排除チェック

## Phase 7: テスト・セキュリティ

- [ ] フロントエンドコンポーネントテスト
- [ ] バックエンド API 統合テスト
- [ ] 分析ロジックのエッジケーステスト
- [ ] npm audit の確認
- [ ] セキュリティヘッダーの検証
- [ ] エラー情報の露出チェック
- [ ] 入力バリデーションの網羅テスト
- [ ] アクセシビリティ基本チェック

## Phase 8: 公開用ドキュメント・デプロイ

- [ ] README の最終整備（スクリーンショット、デモ手順）
- [ ] リポジトリ URL の確定と記載
- [ ] 利用規約（軽量版）の作成
- [ ] デプロイ手順の文書化
- [ ] CI 設定（GitHub Actions: lint, test, build）
- [ ] 本番ビルド最適化（コード分割等）

## Phase 9: 公開前総合確認

- [ ] コードレビュー（Codex による第三者レビュー）
- [ ] 仕様照合（全 Phase 要件の達成確認）
- [ ] セキュリティ確認
- [ ] ローカルパス・個人情報の最終チェック
- [ ] 動作確認（ゼロからのセットアップ再現テスト）
