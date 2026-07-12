# ビルドステージ
FROM node:22-alpine AS builder

WORKDIR /app

# 依存関係をコピーしてインストール
COPY package*.json ./
RUN npm ci

# ソースコードをコピー
COPY . .

# アプリをビルド
RUN npm run build

# 実行ステージ
FROM node:22-alpine

WORKDIR /app

# 本番環境の依存関係のみをインストール
COPY package*.json ./
RUN npm ci --only=production

# ビルドされたアプリをコピー
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/firestore.rules ./

# ポート3000を公開
EXPOSE 3000

# 本番環境を設定
ENV NODE_ENV=production

# サーバーを起動
CMD ["npm", "start"]
