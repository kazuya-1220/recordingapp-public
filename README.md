# RecordingApp（公開デモ版）

税理士事務所などの**面談を録音し、AIが自動で文字起こし・要約する「面談記録システム」**の
外部公開用デモです。スマホ／PCのブラウザで録音すると、音声認識でリアルタイムに文字化され、
別端末でライブ閲覧でき、会話中に発生した「調べておきます」といった宿題を AI（Gemini）が
自動でWeb検索して回答します。録音を保存すると AI が要約とToDo（セカンドアクション）を生成します。

> **本リポジトリについて**
> これは大学院講義「IT基礎技術」向けに用意した、**外部に公開しても安全な独立クローン**です。
> 元の業務用アプリ（`tax-brain/RecordingApp`）とはリポジトリ・GCP/Firebase プロジェクトを
> 完全に分離しており、本リポジトリへの変更が元の本番環境に影響することはありません。
> 顧客管理システム（Kintone）連携など、機密データに触れる機能は無効化しています。

## 主な機能

| 機能 | 説明 |
|------|------|
| 録音・文字起こし | ブラウザの MediaRecorder＋Web Speech API（日本語）でリアルタイム文字起こし |
| ライブ同期 | 4桁のセッションIDで、録音端末と閲覧端末を Firestore 経由でリアルタイム同期 |
| AIリサーチ支援 | 会話中にトリガーワードを検知すると、Gemini＋Google検索で自動調査 |
| AI要約 | 保存時に会話内容の要約とセカンドアクション（ToDo）を自動生成 |
| 記録の検索・閲覧 | ダッシュボードで日付・キーワード・顧客名などで検索、並べ替え |
| 認証 | Firebase Authentication（Googleサインイン） |

## 技術スタック

- フロントエンド：React 19 / TypeScript / Vite / Tailwind CSS
- バックエンド：Node.js / Express（音声保存・AI呼び出しの中継）
- 生成AI：Google Gemini API（`@google/genai`）＋ Google検索グラウンディング
- データベース／認証：Firebase Firestore / Firebase Authentication
- 実行環境：Docker / Google Cloud Run

## ローカルでの実行

**前提：** Node.js 22 以上

```bash
# 1. 依存パッケージのインストール
npm install

# 2. 環境変数の設定（.env.example をコピーして値を入れる）
cp .env.example .env
#   → GEMINI_API_KEY と VITE_FIREBASE_* を、自分で新規作成した
#     Gemini / Firebase プロジェクトの値に設定する（手順は SETUP.md）

# 3. 開発サーバ起動
npm run dev
# → http://localhost:3000
```

> スマホでの録音とライブ同期を試す場合、音声認識（Web Speech API）と
> マイクは Chrome 系ブラウザ・HTTPS 環境での動作が前提です。

## クラウドへのデプロイ / 新規プロジェクト構築

GCP プロジェクトの新設・Firebase の再構築・Cloud Run へのデプロイ手順は
**[SETUP.md](./SETUP.md)** に記載しています。

## ログイン（アクセス制御）について

既定では全ての Google アカウントでサインインできます（外部公開デモのため）。
`VITE_ALLOWED_EMAIL_DOMAIN` を設定すると、特定ドメインのアカウントのみに制限できます。
技術的にはさらに、Firebase Authentication のブロッキング関数やカスタムクレームを使えば、
アカウント単位・ドメイン単位でのきめ細かなアクセス制御も可能です。

## ディレクトリ構成

```
recordingapp-public/
├── server.ts                 # Express サーバ（録音保存・AI要約・アシスタントAPI）
├── src/
│   ├── App.tsx               # 画面ルーティング＋認証（任意のドメイン制限）
│   ├── components/
│   │   ├── Recorder.tsx      # 録音・文字起こし・参加者入力・保存
│   │   ├── LiveView.tsx      # 4桁IDで別端末からライブ閲覧
│   │   ├── GeminiAssistant.tsx # AIリサーチ支援チャット
│   │   ├── Dashboard.tsx     # 記録の一覧・検索・閲覧
│   │   └── SettingsView.tsx  # トリガーワード等の設定
│   └── lib/
│       ├── firebase.ts       # Firebase 初期化（設定は環境変数から）
│       └── assistant.ts      # アシスタントAPIクライアント
├── firestore.rules           # Firestore セキュリティルール
├── .env.example              # 環境変数テンプレート（実キーは含まない）
└── SETUP.md                  # GCP/Firebase 構築・デプロイ手順
```
