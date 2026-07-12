# SETUP ― GCPプロジェクト新設・Firebase再構築・デプロイ手順

このドキュメントは、**元の業務用アプリ（`tax-brain/RecordingApp`）とは完全に分離した、
新しい GCP / Firebase プロジェクト**でこの公開デモを動かすための手順です。
本手順で作成する資源はすべて新規プロジェクトに閉じており、元の本番環境
（Firebase プロジェクト `recordingapp-500917` 等）には一切影響しません。

> **アカウントの「間借り」について**
> 税理士法人タックス・ブレーンの Google/GCP 課金アカウントや GitHub 組織を一部利用する場合でも、
> **プロジェクトは必ず新規に作成**し、既存プロジェクトの設定・データには触れないでください。
> 課金アカウントだけを共有し、プロジェクト・サービスアカウント・APIキーは新規発行するのが安全です。

---

## 0. 前提ツール

```bash
node -v      # v22 以上
gcloud --version
firebase --version   # なければ: npm i -g firebase-tools
```

- Google Cloud CLI（`gcloud`）にログイン: `gcloud auth login`
- Firebase CLI にログイン: `firebase login`

以下では、環境変数として次を使います（自分の値に置き換えてください）。

```bash
export PROJECT_ID="recordingapp-demo-$(date +%Y%m%d)"   # 例。全世界で一意な必要あり
export REGION="asia-northeast1"                          # 東京
export SERVICE_NAME="recording-app"
# 課金アカウントID（法人アカウントを間借りする場合はそのID。gcloud billing accounts list で確認）
export BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX"
```

---

## 1. 新しい GCP プロジェクトを作成し、APIを有効化

```bash
# プロジェクト作成（※新規。既存プロジェクトは指定しない）
gcloud projects create "$PROJECT_ID" --name="RecordingApp Demo"

# 課金アカウントを紐づけ（間借りする法人の課金アカウントでもOK。プロジェクトは新規）
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

# このプロジェクトを既定に
gcloud config set project "$PROJECT_ID"

# 必要なAPIを有効化
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  identitytoolkit.googleapis.com \
  generativelanguage.googleapis.com
```

---

## 2. Firebase を新規プロジェクトに追加し、Web アプリ設定を取得

```bash
# 既存のGCPプロジェクトにFirebaseを追加
firebase projects:addfirebase "$PROJECT_ID"

# Web アプリを登録
firebase apps:create WEB "recordingapp-demo-web" --project "$PROJECT_ID"

# firebaseConfig（apiKey等）を取得して表示
firebase apps:sdkconfig WEB --project "$PROJECT_ID"
```

表示された `apiKey / authDomain / projectId / storageBucket / messagingSenderId / appId`
を、後述の `.env`（`VITE_FIREBASE_*`）に転記します。

---

## 3. Firebase Authentication（Googleサインイン）を有効化

CLI だけでは有効化できない項目があるため、**Firebase コンソール**で設定します。

1. https://console.firebase.google.com → 対象プロジェクトを開く
2. **Authentication** → **始める** → **Sign-in method** → **Google** を有効化
3. **Authentication → Settings → 承認済みドメイン（Authorized domains）** に、
   - `localhost`（ローカル開発用。通常は既定で入っている）
   - Cloud Run のデプロイ後URLのドメイン（例：`recording-app-xxxxxxxx.a.run.app`）※Step 7 の後で追加

> **アクセス制御を絞りたい場合**：`.env` の `VITE_ALLOWED_EMAIL_DOMAIN` に許可ドメイン
> （例：`tax-brain.page`）を設定すると、そのドメインのアカウントのみサインイン可能になります。
> 既定（空）は全 Google アカウント許可です。

---

## 4. Firestore を作成し、セキュリティルールを反映

```bash
# ネイティブモードのFirestoreを作成
gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID"
```

セキュリティルール（`firestore.rules`）を反映します。

```bash
# firebase.json が無い場合は作成
cat > firebase.json <<'JSON'
{ "firestore": { "rules": "firestore.rules" } }
JSON

firebase deploy --only firestore:rules --project "$PROJECT_ID"
```

`firestore.rules` は「所有者のみ自分の記録を読み書き可能」「ライブセッションは4桁IDで取得可能」に
なっています。公開時もこのルールにより、他人の記録は参照できません。

---

## 5. Gemini API キーを取得

1. https://aistudio.google.com/apikey にアクセス（上記プロジェクトを選択）
2. **Create API key** でキーを発行
3. 発行したキーを `.env` の `GEMINI_API_KEY` に設定

> Gemini キーは**サーバ側（server.ts）専用**です。クライアントには渡さない設計にしています。

---

## 6. `.env` を作成してローカル動作確認

```bash
cp .env.example .env
# エディタで .env を開き、Step 2・Step 5 で取得した値を設定する
#   GEMINI_API_KEY=...
#   VITE_FIREBASE_API_KEY=...
#   VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
#   VITE_FIREBASE_PROJECT_ID=<project-id>
#   ... など

npm install
npm run dev
# → http://localhost:3000 を開き、Googleサインイン→録音→保存→ダッシュボード表示 を確認
```

---

## 7. Cloud Run へデプロイ

クライアントの Firebase 設定はビルド時に `dist/` へ埋め込まれるため、
**デプロイ前に必ず `.env` を設定した状態で `npm run build` を実行**します。

### 方法A：手元から手動デプロイ（最短）

```bash
# 1) 本番ビルド（VITE_FIREBASE_* を dist に焼き込む）
npm run build

# 2) Cloud Build で dist を含めてアップロードするため、dist を除外しない .gcloudignore を用意
cat > .gcloudignore <<'IGN'
node_modules/
.git/
.env
.env.local
uploads/
*.log
IGN

# 3) ソースからデプロイ（同梱の Dockerfile が使われる）
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --set-env-vars "NODE_ENV=production,GEMINI_API_KEY=<あなたのGeminiキー>"
```

デプロイ完了後、表示される URL を控えます。

### 方法B：GitHub Actions（`.github/workflows/deploy-cloud-run.yml`）で自動デプロイ

`main` への push で自動デプロイされます。事前に GitHub リポジトリへ以下を設定してください。

- **Variables**：`GCP_PROJECT_ID` / `GCP_REGION` / `CLOUD_RUN_SERVICE` /（任意）`ALLOWED_EMAIL_DOMAIN`
- **Secrets**：`WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT`（Workload Identity 連携）/ `GEMINI_API_KEY` /
  `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` /
  `VITE_FIREBASE_STORAGE_BUCKET` / `VITE_FIREBASE_MESSAGING_SENDER_ID` / `VITE_FIREBASE_APP_ID`

Workload Identity 連携（キーレス認証）の作成例：

```bash
# サービスアカウント作成
gcloud iam service-accounts create gh-deployer --project "$PROJECT_ID"
SA="gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# デプロイに必要なロールを付与
for role in roles/run.admin roles/cloudbuild.builds.editor \
            roles/artifactregistry.admin roles/iam.serviceAccountUser roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role"
done

# Workload Identity プール／プロバイダを作成し、GitHubリポジトリと連携
gcloud iam workload-identity-pools create github --location=global --project "$PROJECT_ID"
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --project "$PROJECT_ID"
# 以降、対象リポジトリを principalSet で SA に紐づけ、WIF_PROVIDER / WIF_SERVICE_ACCOUNT を
# GitHub Secrets に登録します（詳細は google-github-actions/auth のREADME参照）。
```

---

## 8. デプロイURLを Firebase の承認済みドメインに追加

Google サインインを本番URLで機能させるため、Step 7 で得た Cloud Run のドメイン
（例：`recording-app-xxxxxxxx.a.run.app`）を

**Firebase コンソール → Authentication → Settings → 承認済みドメイン** に追加します。

---

## 9. 動作確認

1. デプロイURLをスマホ／PCのChromeで開く
2. Googleでサインイン
3. 録音（マイク許可）→ 文字起こし → 保存 → ダッシュボードに表示
4. 別端末で「Live Sync」に4桁IDを入力 → リアルタイム文字起こしが同期
5. 設定のトリガーワードを会話で発話 → Geminiが自動調査

---

## 付録：元の本番環境と分離するためのチェックリスト

- [ ] `PROJECT_ID` は**新規**（既存の `recordingapp-500917` 等を指定していない）
- [ ] `firebase-applet-config.json` を**コミットしていない**（`.gitignore` 済み。設定は `.env`）
- [ ] Kintone 等の外部業務システムのトークンを**一切設定していない**（本デモでは機能自体を削除）
- [ ] 課金アカウントを共有する場合も、サービスアカウント・APIキーは**新規発行**
- [ ] リポジトリは `tax-brain/RecordingApp` とは**別リポジトリ**

## 付録：コストと停止

- Cloud Run はリクエスト課金（アイドル時ゼロ）。Firestore/Authも小規模なら無料枠内が中心。
- デモ終了時は次で資源を停止・削除できます。
  ```bash
  gcloud run services delete "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID"
  # 完全に片付ける場合はプロジェクトごと削除（新規プロジェクトなので影響範囲が閉じる）
  gcloud projects delete "$PROJECT_ID"
  ```
