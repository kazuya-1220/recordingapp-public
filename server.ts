import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const PORT = 3000;
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

  function validateAscii(value: string, name: string): void {
    if (!value) return;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) {
        throw new Error(`${name}に無効な文字（日本語などの全角文字）が含まれています。設定画面で正しい${name}（半角英数字）を入力してください。`);
      }
    }
  }

  function toRichText(plain: string): string {
    if (!plain) return '';
    return plain
      .split('\n')
      .map(line => `<p>${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '&nbsp;'}</p>`)
      .join('');
  }

  app.post('/api/kintone/sync', async (req, res) => {
    const { domain, appId, apiToken, title, text, createdAt, audioUrl, customerNumber, customerName, participants, geminiResult } = req.body;
    
    if (!domain || !appId || !apiToken) {
      return res.status(400).json({ error: 'Missing Kintone configuration.' });
    }

    const cleanDomain = domain.trim().replace(/^(https?:\/\/)/i, '').replace(/\/+$/, '');

    try {
      validateAscii(apiToken, 'APIトークン');
      validateAscii(cleanDomain, 'サブドメイン');
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    try {
      // 1. Generate Summary and Second Actions using Gemini AI
      let summaryText = '';
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && text && text.trim().length > 0) {
          const ai = new GoogleGenAI({ apiKey });

          console.log('Generating summary and second actions using gemini-3.5-flash...');
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
"${text}"`;

          let geminiResponse;
          try {
            console.log('Generating summary and second actions using gemini-3.5-flash...');
            geminiResponse = await ai.models.generateContent({
              model: 'gemini-3.5-flash',
              contents: prompt
            });
          } catch (err: any) {
            console.warn('gemini-3.5-flash failed or busy. Falling back to gemini-2.5-flash...', err);
            try {
              geminiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
              });
            } catch (err2: any) {
              console.warn('gemini-2.5-flash failed or busy. Falling back to gemini-flash-latest...', err2);
              geminiResponse = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: prompt
              });
            }
          }

          summaryText = geminiResponse.text || '';
          console.log('Successfully generated AI summary.');
        } else {
          summaryText = '（音声文字起こしデータがないため、要約を作成できませんでした）';
        }
      } catch (geminiError: any) {
        console.error('Gemini API Error:', geminiError);
        summaryText = `（AI要約生成エラー: ${geminiError.message || '不明なエラー'}）`;
      }

      // 2. Upload Audio File to Kintone if present
      let fileKey = null;
      if (audioUrl) {
        const filename = path.basename(audioUrl);
        const filePath = path.join(process.cwd(), 'uploads', filename);

        if (fs.existsSync(filePath)) {
          const fileBuffer = fs.readFileSync(filePath);
          const fileBlob = new Blob([fileBuffer], { type: 'audio/webm' });
          
          const uploadFormData = new FormData();
          // Provide a standard filename for Kintone's attachments
          uploadFormData.append('file', fileBlob, `recording_${Date.now()}.webm`);

          const uploadUrl = `https://${cleanDomain}/k/v1/file.json`;
          console.log(`Uploading file to Kintone: ${uploadUrl}`);
          
          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'X-Cybozu-API-Token': apiToken
            },
            body: uploadFormData
          });

          const uploadText = await uploadRes.text();
          let uploadData: any;
          try {
            uploadData = JSON.parse(uploadText);
          } catch (jsonErr) {
            uploadData = null;
          }

          if (!uploadRes.ok) {
            const errMsg = uploadData && uploadData.message ? uploadData.message : uploadText.slice(0, 500);
            throw new Error(`Kintone File Upload Error (HTTP ${uploadRes.status}): ${errMsg}`);
          }

          if (!uploadData || !uploadData.fileKey) {
            throw new Error(`Kintone File Upload response was invalid: ${uploadText.slice(0, 500)}`);
          }

          fileKey = uploadData.fileKey;
          console.log(`Successfully uploaded file, fileKey: ${fileKey}`);
        } else {
          console.warn(`File not found on server disk: ${filePath}`);
        }
      }

      // 3. Create Record on Kintone
      const kintoneUrl = `https://${cleanDomain}/k/v1/record.json`;
      
      let textWithMeta = text || '';
      if (customerNumber || customerName || (participants && participants.length > 0)) {
        const metaLines = [];
        metaLines.push('【打ち合わせ基本情報】');
        if (customerNumber) metaLines.push(`・顧客番号: ${customerNumber}`);
        if (customerName) metaLines.push(`・顧客名: ${customerName}`);
        if (participants && participants.length > 0) {
          const pList = Array.isArray(participants) ? participants.join(', ') : participants;
          metaLines.push(`・出席者: ${pList}`);
        }
        metaLines.push('---------------------------');
        metaLines.push('');
        textWithMeta = metaLines.join('\n') + textWithMeta;
      }

      const record: any = {
        Title: { value: title || '音声入力データ' },
        Text: { value: textWithMeta },
        Date: { value: new Date(createdAt).toISOString().split('T')[0] },
        "要約_セカンドアクション": { value: summaryText },
        "Gemini生成結果": { value: toRichText(geminiResult || '') }
      };

      if (fileKey) {
        record["添付ファイル"] = {
          value: [
            { fileKey: fileKey }
          ]
        };
      }

      const payload = {
        app: parseInt(appId, 10),
        record
      };

      console.log(`Creating Kintone record at: ${kintoneUrl}`);
      const kintoneRes = await fetch(kintoneUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cybozu-API-Token': apiToken
        },
        body: JSON.stringify(payload)
      });

      const kintoneText = await kintoneRes.text();
      let kintoneData: any;
      try {
        kintoneData = JSON.parse(kintoneText);
      } catch (jsonErr) {
        kintoneData = null;
      }

      if (!kintoneRes.ok) {
        const errMsg = kintoneData && kintoneData.message ? kintoneData.message : kintoneText.slice(0, 500);
        throw new Error(`Kintone Record Creation Error (HTTP ${kintoneRes.status}): ${errMsg}`);
      }

      res.json({ success: true, summary: summaryText });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error communicating with Kintone' });
    }
  });

  app.post('/api/kintone/customers', async (req, res) => {
    const { domain, customerAppId, customerApiToken, keyword, nameField = '顧客名', numberField = '顧客番号' } = req.body;
    
    if (!domain || !customerAppId || !customerApiToken) {
      return res.status(400).json({ error: 'Missing Kintone configuration for customer lookup.' });
    }

    const cleanDomain = domain.trim().replace(/^(https?:\/\/)/i, '').replace(/\/+$/, '');

    try {
      validateAscii(customerApiToken, '顧客アプリのAPIトークン');
      validateAscii(cleanDomain, 'サブドメイン');
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    const kintoneUrl = `https://${cleanDomain}/k/v1/records.json`;

    // Build the query to look up records
    // Example: (顧客名 like "山田" or 顧客番号 like "山田") order by $id desc limit 50
    let query = '';
    const cleanNameField = nameField.trim() || '顧客名';
    const cleanNumberField = numberField.trim() || '顧客番号';

    if (keyword && keyword.trim().length > 0) {
      const escapedKeyword = keyword.trim().replace(/"/g, '\\"');
      query = `(${cleanNameField} like "${escapedKeyword}" or ${cleanNumberField} like "${escapedKeyword}") order by $id desc limit 50`;
    } else {
      query = 'order by $id desc limit 50';
    }

    try {
      console.log(`Fetching Kintone customers from: ${kintoneUrl}?app=${customerAppId}&query=${query}`);
      const response = await fetch(`${kintoneUrl}?app=${customerAppId}&query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'X-Cybozu-API-Token': customerApiToken
        }
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = null;
      }

      if (!response.ok) {
        const errMsg = data && data.message ? data.message : text.slice(0, 500);
        throw new Error(`Kintone Customer Lookup Error (HTTP ${response.status}): ${errMsg}`);
      }

      const records = data.records || [];
      const customers = records.map((rec: any) => {
        return {
          id: rec.$id?.value || '',
          name: rec[cleanNameField]?.value || '',
          number: rec[cleanNumberField]?.value || '',
        };
      });

      res.json({ success: true, customers });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error fetching customers from Kintone' });
    }
  });

  app.get('/api/kintone/default-settings', (req, res) => {
    res.json({
      domain: process.env.KINTONE_DOMAIN || '',
      appId: process.env.KINTONE_APP_ID || '',
      apiToken: process.env.KINTONE_API_TOKEN || '',
      customerAppId: process.env.KINTONE_CUSTOMER_APP_ID || '',
      customerApiToken: process.env.KINTONE_CUSTOMER_API_TOKEN || '',
      customerNameField: process.env.KINTONE_CUSTOMER_NAME_FIELD || '顧客名',
      customerNumberField: process.env.KINTONE_CUSTOMER_NUMBER_FIELD || '顧客番号'
    });
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
