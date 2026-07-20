# 自動デプロイ (GitHub Actions → Cloud Run) セットアップ

`main` への push で `it-kadai` の Cloud Run に自動デプロイします。認証は
**Workload Identity Federation（キーレス）**。以下は **一度だけ** 実施する準備です。

> 実行者は `it-kadai` プロジェクトのオーナー権限で `gcloud`（Cloud Shell 推奨）に
> ログインしていること。

## 0. 変数

```bash
export PROJECT_ID=it-kadai
export SA_NAME=github-deployer
export SA_EMAIL=${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com
export REPO=kazuya-1220/recordingapp-public
export POOL=github-pool
export PROVIDER=github-provider
```

## 1. 必要な API を有効化

```bash
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com aiplatform.googleapis.com \
  storage.googleapis.com --project $PROJECT_ID
```

## 2. デプロイ兼ランタイム用サービスアカウント

```bash
gcloud iam service-accounts create $SA_NAME --project $PROJECT_ID \
  --display-name="GitHub Actions deployer"
```

## 3. 権限付与

```bash
# デプロイ用
for R in roles/run.admin roles/cloudbuild.builds.editor \
         roles/artifactregistry.admin roles/storage.admin \
         roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" --role="$R"
done

# アプリ実行用（Vertex AI 文字起こし / GCS 読み書き）
for R in roles/aiplatform.user roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" --role="$R"
done

# 署名付きURL(v4/signBlob)のため、自分自身に TokenCreator を付与
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL --project $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" --role="roles/iam.serviceAccountTokenCreator"
```

## 4. Workload Identity プール & プロバイダ

```bash
gcloud iam workload-identity-pools create $POOL --project $PROJECT_ID \
  --location=global --display-name="GitHub Actions pool"

gcloud iam workload-identity-pools providers create-oidc $PROVIDER \
  --project $PROJECT_ID --location=global --workload-identity-pool=$POOL \
  --display-name="GitHub provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'"
```

## 5. リポジトリに SA 借用を許可

```bash
export WIF_POOL_ID=$(gcloud iam workload-identity-pools describe $POOL \
  --project $PROJECT_ID --location=global --format='value(name)')

gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL --project $PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WIF_POOL_ID}/attribute.repository/${REPO}"
```

## 6. GitHub シークレットに登録する値を取得

```bash
# WIF_PROVIDER に設定する完全リソース名
gcloud iam workload-identity-pools providers describe $PROVIDER \
  --project $PROJECT_ID --location=global --workload-identity-pool=$POOL \
  --format='value(name)'
# 例: projects/123456789/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

GitHub リポジトリ → **Settings → Secrets and variables → Actions** で登録：

| Secret 名 | 値 |
|---|---|
| `WIF_PROVIDER` | 上で出力された `projects/.../providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | `github-deployer@it-kadai.iam.gserviceaccount.com` |
| `GEMINI_API_KEY` | （任意）AIアシスタント機能用の Gemini API キー |

## 7. GCS バケットの CORS（ブラウザからの直接アップロード用）

```bash
cat > cors.json <<'EOF'
[{"origin":["https://＜アプリのURL＞"],"method":["PUT","GET"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
EOF
gcloud storage buckets update gs://it-kadai-audio --cors-file=cors.json
```

> `storage.objectAdmin`（手順3）でバケットの読み書きは付与済みのため、
> `objectViewer` の追加付与は不要です。署名は TokenCreator（手順3）でOK。

## 8. サービス名の確認

`.github/workflows/deploy-cloud-run.yml` の `SERVICE_NAME` を、既存のデモ用
Cloud Run サービス名に合わせてください（違う名前だと別URLの新サービスが作られます）。

```bash
gcloud run services list --project it-kadai --region asia-northeast1
```

## 9. デプロイ

上記を設定後、この修正を含む PR を `main` にマージすると自動でデプロイされます。
以降は `main` への push ごとに自動デプロイされます。
