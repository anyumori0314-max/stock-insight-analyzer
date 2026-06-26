# コントリビューションガイド (Contributing)

Stock Insight Analyzer への変更は、すべて **CI（GitHub Actions）が緑** になることを
マージ条件とします。このドキュメントは CI の内容、ローカルでの再現方法、PR 前チェック
リスト、Branch protection の設定手順をまとめます。

CI は **完全オフライン** です。Alpha Vantage への実通信・実 API キー・永続 DB・実 CSV を
一切使用しません。すべての一時データは runner の temp ディレクトリに生成し、実行後に破棄
します。

---

## 1. CI が実行する内容（`.github/workflows/ci.yml`）

Node.js のバージョンは `root` / `backend` / `frontend` の `engines.node`（`>=22.5.0`、
`node:sqlite` に必要）に合わせて **22.x** を使用します。

### Linux ジョブ（フルゲート）

1. checkout
2. Node.js 22 セットアップ（npm キャッシュ）
3. 依存関係インストール（`npm ci` を root / backend / frontend で実行）
4. typecheck（frontend + backend）
5. Backend テスト
6. Frontend テスト
7. オフライン CI smoke（マイグレーション + CSV backfill + 冪等性）
8. 本番ビルド（frontend + backend）
9. 監査 root（`npm audit --audit-level=high`）
10. 監査 frontend
11. 監査 backend
12. 禁止ファイル検査（`scripts/check-forbidden-files.sh`）
13. SQLite マイグレーション smoke（実 CLI `data:import`）
14. CSV import smoke（実 CLI `data:backfill`、冪等再実行）

### Windows ジョブ（クロスプラットフォーム確認）

Linux より軽量で、Windows 固有のリスク領域（`node:sqlite` のパス処理、PowerShell の
引数クォート、CLI 配線）に絞って確認します。

- 依存関係インストール
- typecheck
- Backend テスト（SQLite のパス処理は Windows で差異が出やすいため実行）
- オフライン CI smoke
- PowerShell スクリプト構文チェック（`scripts/*.ps1` をパーサで検証。なければ no-op）
- SQLite + CSV import smoke（**スペースを含む一時パス**で実 CLI を実行し、Windows の
  パス処理と引数クォートを同時に検証）

### ジョブの役割分担

- **Linux** … すべてのゲート（テスト・ビルド・監査・禁止ファイル・smoke）を実行する主検証。
- **Windows** … Linux と重複する全テストは流さず、クロスプラットフォームで壊れやすい
  箇所（SQLite パス・PowerShell 引数・CLI）だけを確認する補助検証。

---

## 2. ローカルで同じ検証を行うコマンド

PowerShell（Windows）でも Bash（Linux/macOS）でも同じ npm scripts で再現できます。

```powershell
npm.cmd ci                          # 依存関係（root）
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci

npm.cmd run typecheck               # 4. typecheck
npm.cmd run test:run                # 5-6. backend + frontend テスト
npm.cmd run ci:smoke                # 7. オフライン smoke
npm.cmd run build                   # 8. 本番ビルド
npm.cmd audit --audit-level=high            # 9. 監査 root
npm.cmd --prefix frontend audit --audit-level=high   # 10.
npm.cmd --prefix backend audit --audit-level=high    # 11.
bash scripts/check-forbidden-files.sh        # 12. 禁止ファイル検査
git diff --check                             # 空白エラー検査
```

> `npm audit`（レベル指定なし）は現状すべて 0 vulnerabilities です。CI は将来の低～中
> 深刻度アドバイザリで赤くならないよう `--audit-level=high` を閾値にしています。新規の
> high/critical が出た場合は **必ず** 依存を更新して解消してください。

CLI の手動 smoke（一時ディレクトリと fixture のみ。実 DB・実 CSV を使わない）:

```powershell
$work = Join-Path $env:TEMP "siа-smoke"
$env:STOCK_DB_PATH = Join-Path $work "history.sqlite"
npm.cmd run data:import   -- --file "<生成した一時CSV>"
npm.cmd run data:backfill -- --csv-directory "<一時CSVディレクトリ>"
npm.cmd run data:daily    -- --tickers SMOKE --dry-run
```

---

## 3. PR 前チェックリスト

- [ ] `npm run typecheck` が成功する
- [ ] `npm run test:run`（backend + frontend）が成功する
- [ ] `npm run ci:smoke` が成功する
- [ ] `npm run build` が成功する
- [ ] `npm audit` / `--prefix frontend` / `--prefix backend` に high/critical がない
- [ ] `bash scripts/check-forbidden-files.sh` が成功する（秘密情報・実 DB・実 CSV・
      ビルド成果物・絶対パスを追跡していない）
- [ ] `git diff --check`（行末空白・コンフリクトマーカーなし）
- [ ] `.env` や API キーを **コミットしていない**（`.env.example` のみ追跡）
- [ ] 仕様変更時は README / docs を更新した
- [ ] 破壊的変更は PR 説明に明記した

---

## 4. Branch protection の設定手順（リポジトリ管理者向け）

> 本リポジトリの GitHub 上の設定はコードからは変更しません。以下は管理者が GitHub UI /
> API で **手動設定** する手順です。

### 4.1 CI 成功をマージ条件にする（GitHub UI）

1. **Settings → Branches → Branch protection rules → Add rule**。
2. **Branch name pattern** に `main` を入力。
3. **Require a pull request before merging** を有効化（必要なら **Require approvals** も）。
4. **Require status checks to pass before merging** を有効化。
5. 検索ボックスで以下の status check を追加（最低 1 回 CI を走らせると候補に出ます）:
   - `Linux (lint, test, build, smoke)`
   - `Windows (smoke + path handling)`
6. **Require branches to be up to date before merging** を有効化（任意だが推奨）。
7. **Do not allow bypassing the above settings** を有効化（管理者にも適用）。
8. **Create / Save changes**。

### 4.2 CLI（`gh`）で設定する場合の例

```bash
gh api -X PUT repos/<OWNER>/<REPO>/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Linux (lint, test, build, smoke)' \
  -f 'required_status_checks[contexts][]=Windows (smoke + path handling)' \
  -f 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'restrictions=null'
```

---

## 5. Actions Secrets を登録する場合の注意事項

現状の CI は **秘密情報を一切必要としません**（オフライン smoke のみ）。将来、実 API を
使う E2E などを追加して Secret が必要になった場合は、以下を厳守してください。

- Secret は **Settings → Secrets and variables → Actions** にのみ登録し、ワークフロー
  からは `${{ secrets.NAME }}` で参照する。**ワークフローや任意のファイルに直書きしない**。
- ログへ出力しない。`echo "$SECRET"` などは禁止（GitHub のマスキングに依存しない）。
- `pull_request` トリガはフォークからの PR に Secret を渡しません。実 API を使うジョブは
  `push`（信頼ブランチ）か `workflow_dispatch`、または `pull_request_target` の取り扱いを
  十分に検討した上でのみ追加する。
- 実 API キーは **無料枠の使い捨てキー** を用い、本番キーは CI に置かない。
- Secret を追加しても、本リポジトリの規約（実通信を伴うジョブはデフォルトの PR ゲートに
  しない）を変えないこと。デフォルトの CI はオフラインのまま維持する。
