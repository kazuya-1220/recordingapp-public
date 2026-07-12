import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOADS_DIR });

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);

  app.use(express.json());
  app.use('/uploads', express.static(UPLOADS_DIR));

  // 録音ファイルの受け取り（サーバローカルディスクに保存）
  app.post('/api/recordings', upload.single('audio'), (req, res) => {
    const file = req.file;
    res.json({
      audioUrl: file ? `/uploads/${file.filename}` : null
    });
  });

  function createGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
  }

  const GEMINI_MODEL_CHAIN = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

  async function generateWithFallback(
    ai: GoogleGenAI,
    request: { contents: any; config?: any }
  ) {
    let lastError: any = null;
    for (const model of GEMINI_MODEL_CHAIN) {
      try {
        return await ai.models.generateContent({ model, ...request });
      } catch (err: any) {
        console.warn(`${model} failed or busy. Trying next model...`, err?.message || err);
        lastError = err;
      }
    }
    throw lastError || new Error('All Gemini models failed');
  }

  // AI要約とセカンドアクション（ToDo）を生成する
  app.post('/api/summarize', async (req, res) => {
    const { text } = req.body;
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません。' });
    }
    if (!text || String(text).trim().length === 0) {
      return res.json({ summary: '（音声文字起こしデータがないため、要約を作成できませんでした）' });
    }

    const prompt = `あなたは優秀なアシスタントです。提供された音声文字起こしテキストから、次の2つのセクションを日本語で作成してください。

1. 会話内容の要約（日本語で100文字程度、簡潔で見やすいまとめ）
2. 今後の具体的なアクション（セカンドアクション）や何かしらのアクションが必要がある内容・ToDo事項

出力フォーマットは以下のように、見出しをつけて分かりやすく作成してください：

【要約】
（ここに100文字程度の要約）

【セカンドアクション】
・（アクション項目1）
・（アクション項目2）

音声文字起こしテキスト：
"${String(text)}"`;

    try {
      const response = await generateWithFallback(ai, { contents: prompt });
      res.json({ summary: (response.text || '').trim() });
    } catch (error: any) {
      console.error('Summarize error:', error);
      res.status(500).json({ error: error.message || '要約の生成に失敗しました。' });
    }
  });

  // ライブ同期アシスタント: 文字起こしから調査タスクを抽出
  app.post('/api/assistant/extract-task', async (req, res) => {
    const { transcript, triggerWord } = req.body;

    if (!transcript || !triggerWord) {
      return res.status(400).json({ error: 'transcript と triggerWord は必須です。' });
    }

    const ai = createGeminiClient();
    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません。' });
    }

    const prompt = `あなたは会議アシスタントです。以下の会議の文字起こしの中で、話者が「${triggerWord}」と発言しました。
その発言の直前までの会話の流れから、話者が「調べておく」と言った調査タスク（調べるべき事項・質問）を1つ抽出してください。

出力ルール:
- タスク内容のみを、簡潔な日本語（1〜2文）で出力する
- 前置きや見出し、記号は付けない

文字起こし:
"${String(transcript).slice(-6000)}"`;

    try {
      const response = await generateWithFallback(ai, { contents: prompt });
      const task = (response.text || '').trim();
      if (!task) {
        throw new Error('調査タスクを抽出できませんでした。');
      }
      res.json({ task });
    } catch (error: any) {
      console.error('Assistant extract-task error:', error);
      res.status(500).json({ error: error.message || '調査タスクの抽出に失敗しました。' });
    }
  });

  // ライブ同期アシスタント: Web検索グラウンディング付きチャット（初回調査・追加対話の両方で使用）
  app.post('/api/assistant/chat', async (req, res) => {
    const { messages, transcript, pastTranscripts } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages は必須です。' });
    }

    const ai = createGeminiClient();
    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません。' });
    }

    let pastText = '（なし）';
    if (Array.isArray(pastTranscripts) && pastTranscripts.length > 0) {
      pastText = pastTranscripts
        .slice(0, 5)
        .map((r: any) => {
          const date = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '不明';
          const body = String(r.summary || r.text || '').slice(0, 1500);
          return `■ ${r.title || '無題'}（${date}）\n${body}`;
        })
        .join('\n\n');
    }

    const systemInstruction = `あなたは会議中に並行して調査を行う優秀なAIアシスタントです。
会議の参加者が「調べておきます」と言った事項を代わりに調査し、日本語で簡潔かつ具体的に回答してください。
必要に応じてWeb検索を活用し、以下の参考情報（現在の会議の文字起こし・過去の文字起こし）も踏まえて推論してください。
ユーザーからの追加の質問や指示には、それまでの対話の文脈を踏まえて回答を改善してください。

【現在の会議の文字起こし（最新部分）】
${String(transcript || '').slice(-6000) || '（なし）'}

【過去の文字起こし・議事録】
${pastText}`;

    const contents = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

    try {
      const response = await generateWithFallback(ai, {
        contents,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }]
        }
      });

      const reply = (response.text || '').trim();
      if (!reply) {
        throw new Error('回答を生成できませんでした。');
      }

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks
        .map((chunk: any) => ({
          title: chunk?.web?.title || '',
          uri: chunk?.web?.uri || ''
        }))
        .filter((s: any) => s.uri);

      res.json({ reply, sources });
    } catch (error: any) {
      console.error('Assistant chat error:', error);
      res.status(500).json({ error: error.message || '回答の生成に失敗しました。' });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
