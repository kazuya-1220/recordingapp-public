import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // 注意：GEMINI_API_KEY はサーバ側（server.ts）でのみ使用する。
  // クライアントバンドルに秘密鍵を埋め込まないよう、ここでは define しない。
  // クライアントに渡す設定は VITE_ プレフィックス付きの環境変数を使う
  //（Vite が自動で import.meta.env に公開する）。
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
