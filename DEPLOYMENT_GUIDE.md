# Cloud Run デプロイガイド（公開デモ版）

本リポジトリは RecordingApp の公開デモ版です。Firebase 接続先は検証用プロジェクト
`it-kadai` を使用します。本番プロジェクトとは完全に分離されています。

## 前提

- Google Cloud プロジェクト（例：`it-kadai`）
- Firebase Authentication（Google ログイン）有効化済み
- Firestore 有効化済み

## Firebase 設定

クライアントの Firebase 設定は [`firebase-applet-config.json`](firebase-applet-config.json)
に記載されています（Firebase Web 設定は公開情報です）。別プロジェクトへ向ける場合は
このファイルの値を差し替えてください。

## デプロイ（Cloud Shell から）

```bash
# リポジトリを取得
git clone https://github.com/kazuya-1220/recordingapp-public.git
cd recordingapp-public

# Cloud Run へデプロイ（コンテナ内でビルドされます）
gcloud run deploy recording-app \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000
```

Dockerfile がマルチステージビルドでフロントエンド／サーバーを生成するため、
`dist/` をコミットする必要はありません。

## 秘密情報について

- **Gemini API キー**：`.env.local` に `GEMINI_API_KEY=...` を記載します。
  `.env.local` は `.gitignore` 済みでコミットされません。
- サービスアカウント鍵・Kintone トークン等の実値は **本リポジトリには含めません**。
  各自の環境変数／Secret Manager で管理してください。

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `auth/unauthorized-domain` | Firebase コンソール → Authentication → 設定 → 承認済みドメインに Cloud Run の URL を追加 |
| `auth/api-key-not-valid` | `firebase-applet-config.json` の `apiKey` が対象プロジェクトのものか確認 |
| ビルド失敗 | ローカルで `npm ci && npm run build` が通るか確認 |

## 参考リンク

- [Google Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
