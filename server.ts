import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';

const PORT = parseInt(process.env.PORT || '3000', 10);
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOADS_DIR });

/**
 * multer (busboy) decodes multipart filenames as latin1 by default, which
 * garbles non-ASCII (e.g. Japanese) filenames into mojibake. Re-interpret the
 * bytes as UTF-8 to restore the original name. Pure-ASCII names are unaffected.
 */
function decodeOriginalName(name: string): string {
  if (!name) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    // If the round-trip lost data (invalid utf8), keep the original.
    return decoded.includes('�') ? name : decoded;
  } catch {
    return name;
  }
}

// ── Google Cloud Storage (persistent audio/attachment storage) ────────────
const GCS_BUCKET = process.env.GCS_BUCKET || 'it-kadai-audio';
let gcsStorage: Storage | null = null;
try {
  gcsStorage = new Storage();
  console.log(`[GCS] Initialized, bucket: ${GCS_BUCKET}`);
} catch (e: any) {
  console.warn(`[GCS] Unavailable: ${e.message} — files use ephemeral local storage`);
}

async function uploadToGCS(localPath: string, destName: string): Promise<boolean> {
  if (!gcsStorage) return false;
  try {
    await gcsStorage.bucket(GCS_BUCKET).upload(localPath, { destination: destName });
    return true;
  } catch (err: any) {
    console.warn(`[GCS] Upload failed for ${destName}: ${err.message}`);
    return false;
  }
}

async function getFileBuffer(filename: string): Promise<Buffer | null> {
  const localPath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
  if (!gcsStorage) return null;
  try {
    const [data] = await gcsStorage.bucket(GCS_BUCKET).file(filename).download();
    return Buffer.from(data);
  } catch (err: any) {
    console.warn(`[GCS] Download failed for ${filename}: ${err.message}`);
    return null;
  }
}

// ── Kintone Rich-text helpers ──────────────────────────────────────────────

// NOTE: fictional names for the public demo only.
const TAX_BRAIN_MEMBER_SET = new Set([
  '田中 太郎', '鈴木 花子', '高橋 健一', '渡辺 美咲', '伊藤 大輔',
  '山田 由美', '中村 翔太', '小林 彩香', '加藤 直樹', '吉田 恵子',
  '松本 亮', '井上 真央', '木村 拓也', '林 さやか', '清水 隆',
  '山下 一馬',
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Plain text → Kintone HTML: each non-empty line becomes <p>, blank lines add spacing.
function plainToKintoneHtml(text: string): string {
  if (!text) return '';
  return text.split('\n').map(line => {
    const t = line.trim();
    return t ? `<p>${escapeHtml(t)}</p>` : '<p>&nbsp;</p>';
  }).join('');
}

/**
 * Kintone のリッチエディターフィールド向けに AI 出力テキストを HTML に変換する。
 * ## / ==X== / ━━━ X ━━━ → <h3>, ・/□ → <ul><li>, 数字行 → <li>, **X** → <strong>
 * 連続する通常テキスト行は <p> 内で <br> 結合して行間を詰める。
 */
function toKintoneHtml(text: string): string {
  if (!text) return '';
  const isListLine = (l: string) =>
    l.startsWith('・') || l.startsWith('□') ||
    /^[１２３４５６７８９０]/.test(l) || /^\d+[.．\s]/.test(l);

  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let pendingLines: string[] = [];

  const flushText = () => {
    if (pendingLines.length > 0) {
      html += `<p>${pendingLines.join('<br>')}</p>`;
      pendingLines = [];
    }
  };
  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trim();

    if (!line) {
      if (inList) {
        // Look ahead: skip blank lines between consecutive list items
        const nextNonEmpty = lines.slice(idx + 1).find(l => l.trim()).trim() ?? '';
        if (isListLine(nextNonEmpty)) continue;
        closeList();
      } else {
        flushText();
      }
      continue;
    }

    // Markdown headers: ## X or ### X
    const hMd = line.match(/^#{1,3}\s+(.+)$/);
    // Legacy headers: ==X== or ━━━ X ━━━
    const hLeg = line.match(/^(?:==+|━+)\s*(.+?)\s*(?:==+|━+)$/);
    if (hMd || hLeg) {
      flushText();
      closeList();
      html += `<h3><strong>${escapeHtml((hMd ? hMd[1] : hLeg![1]))}</strong></h3>`;
      continue;
    }

    // Bullet: ・ □
    if (line.startsWith('・') || line.startsWith('□')) {
      flushText();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(line.slice(1).trim())}</li>`;
      continue;
    }

    // Numbered items: fullwidth (１) or halfwidth (1.) at line start
    const nFW = line.match(/^([１２３４５６７８９０])(.+)/);
    const nHW = line.match(/^(\d+)[.．\s]\s*(.+)/);
    if (nFW || nHW) {
      flushText();
      if (!inList) { html += '<ul>'; inList = true; }
      const content = nFW ? nFW[2] : nHW![2];
      html += `<li>${escapeHtml(content)}</li>`;
      continue;
    }

    // Regular text — accumulate; will be flushed as single <p> with <br> between lines
    closeList();
    const withBold = escapeHtml(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    pendingLines.push(withBold);
  }

  flushText();
  closeList();
  return html;
}

async function startServer() {
  console.log(`[Server] NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`[Server] Starting in ${process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

  const app = express();
  const httpServer = createHttpServer(app);

  // Allow Firebase Auth signInWithPopup to communicate with the opener window.
  // Without this, COOP same-origin blocks window.closed / window.close calls
  // that Firebase SDK uses to detect popup completion on mobile browsers.
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });

  app.use(express.json());
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
  // Legacy static uploads (backward-compat for old Firestore records)
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Serve files: local first, GCS fallback (persists across container restarts)
  app.get('/api/files/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).send('Invalid filename');
    }
    const mimeMap: Record<string, string> = {
      '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.csv': 'text/csv; charset=utf-8',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain; charset=utf-8',
    };
    // Optional query params:
    //   ?name=<utf8 display name>   sets the human-readable filename for both
    //                               inline viewing and downloads (Content-Disposition filename*).
    //   ?download=1                 forces attachment disposition (browser download).
    const displayName = typeof req.query.name === 'string' ? req.query.name : '';
    const forceDownload = req.query.download === '1' || req.query.download === 'true';

    // Multer stores uploads with random UUID-like names WITHOUT extensions, so
    // we can't infer the mime type from the on-disk filename. Derive it from
    // the client-supplied display name (?name=…) instead — this is what lets
    // the browser render PDFs / images inline instead of downloading them as
    // octet-stream.
    const ext = (
      path.extname(displayName) || path.extname(filename)
    ).toLowerCase();
    const contentType = mimeMap[ext] || 'application/octet-stream';

    if (displayName) {
      const encoded = encodeURIComponent(displayName);
      const disposition = forceDownload ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    } else if (forceDownload) {
      res.setHeader('Content-Disposition', 'attachment');
    }

    const localPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(localPath)) {
      res.setHeader('Content-Type', contentType);
      return res.sendFile(localPath);
    }
    const buffer = await getFileBuffer(filename);
    if (buffer) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length.toString());
      return res.send(buffer);
    }
    return res.status(404).send('File not found');
  });

  // Issue a v4 signed URL so the browser can upload large audio DIRECTLY to
  // GCS, bypassing Cloud Run's 32 MiB request-body limit (which otherwise
  // blocks long recordings — roughly 30+ minutes of webm/opus). The client
  // PUTs the blob to `uploadUrl`, then passes `objectName` to /api/recordings.
  app.post('/api/uploads/signed-url', async (req, res) => {
    try {
      if (!gcsStorage) return res.status(503).json({ error: 'GCS unavailable' });
      const { filename, contentType } = req.body || {};
      const rawExt = path.extname(typeof filename === 'string' ? filename : '').toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '.webm';
      const objectName = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
      const ct = typeof contentType === 'string' && contentType ? contentType : 'application/octet-stream';
      const [uploadUrl] = await gcsStorage.bucket(GCS_BUCKET).file(objectName).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: ct,
      });
      res.json({ uploadUrl, objectName, fileUrl: `/api/files/${objectName}`, contentType: ct });
    } catch (err: any) {
      console.error('[/api/uploads/signed-url] ERROR:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create signed URL' });
    }
  });

  app.post('/api/recordings', upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const audioFile = files?.['audio']?.[0];
      const attachmentFiles = files?.['attachments'] || [];

      let audioUrl: string | null = null;
      if (audioFile) {
        // Small-file / fallback path: audio came through the app server.
        uploadToGCS(audioFile.path, audioFile.filename).catch(() => {});
        audioUrl = `/api/files/${audioFile.filename}`;
      } else if (typeof req.body.audioObjectName === 'string' && req.body.audioObjectName) {
        // Large-file path: audio was uploaded directly to GCS via a signed URL.
        const name = req.body.audioObjectName;
        if (!name.includes('/') && !name.includes('..')) {
          audioUrl = `/api/files/${name}`;
        }
      }

      let attachmentsOcr: Array<{ ocrText: string | null }> = [];
      try { attachmentsOcr = JSON.parse(req.body.attachmentsOcr || '[]'); } catch { }

      const recorderAttachments = attachmentFiles.map((f, i) => ({
        url: `/api/files/${f.filename}`,
        name: decodeOriginalName(f.originalname),
        ocrText: attachmentsOcr[i]?.ocrText ?? null,
      }));
      attachmentFiles.forEach(f => uploadToGCS(f.path, f.filename).catch(() => {}));

      // Merge pre-uploaded attachments from LiveView (already on GCS)
      let liveAtts: Array<{ url: string; name: string; ocrText: string | null }> = [];
      try { liveAtts = JSON.parse(req.body.liveAttachments || '[]'); } catch { }
      const attachments = [...recorderAttachments, ...liveAtts];

      // Generate the formatted transcript via the shared helper (with fallback chain).
      const formattedText = await generateFormattedText(req.body.text || '');

      console.log(`[/api/recordings] saved: audioUrl=${audioUrl}, attachments=${attachments.length}, formattedText=${formattedText ? `yes (${formattedText.length} chars)` : 'no'}`);
      res.json({ audioUrl, attachments, formattedText });
    } catch (err: any) {
      console.error('[/api/recordings] ERROR:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  // Transcribe endpoint: upload audio → Gemini speaker-labeled transcription
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio file' });

      const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const ai = new GoogleGenAI({ vertexai: true, project, location });

      const audioData = fs.readFileSync(req.file.path).toString('base64');
      const mimeType = req.file.mimetype || 'audio/webm';

      const prompt = `この音声を文字起こしし、話者ごとにラベルを付けて出力してください。
出力形式（各発言を1行で）：
話者1: 発言内容
話者2: 発言内容

ルール：
- 話者は「話者1」「話者2」など番号で区別してください
- 会話の流れに沿って順番通りに出力してください
- 音声が聞き取れない部分は[聞き取り不能]と記載してください
- 前置きや説明なしに、発言の一覧のみを出力してください`;

      const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001'];
      let rawText = '';
      for (const model of models) {
        try {
          const result = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [
              { text: prompt },
              { inlineData: { mimeType, data: audioData } }
            ]}]
          });
          rawText = result.text || '';
          break;
        } catch (e: any) {
          if (model === models[models.length - 1]) throw e;
          console.warn(`[/api/transcribe] ${model} failed: ${e.message}, retrying...`);
        }
      }

      const transcript: { speaker: string; text: string }[] = [];
      for (const line of rawText.split('\n')) {
        const match = line.match(/^(話者\d+|Speaker\s*\d+)[：:]\s*(.+)/);
        if (match) transcript.push({ speaker: match[1], text: match[2].trim() });
      }

      uploadToGCS(req.file.path, req.file.filename).catch(() => {});
      const audioUrl = `/api/files/${req.file.filename}`;

      console.log(`[/api/transcribe] done: ${transcript.length} lines, audioUrl=${audioUrl}`);
      res.json({ audioUrl, transcript, rawText });
    } catch (err: any) {
      console.error('[/api/transcribe] ERROR:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  // OCR endpoint: call Gemini Vision on uploaded files, return text per file
  app.post('/api/ocr', upload.fields([{ name: 'files', maxCount: 10 }]), async (req, res) => {
    const files = (req.files as { [k: string]: Express.Multer.File[] })?.['files'] || [];
    if (files.length === 0) return res.json({ results: [] });

    const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
    const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
    const ai = new GoogleGenAI({ vertexai: true, project, location });

    const ocrMime: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.tiff': 'image/tiff', '.tif': 'image/tiff',
    };

    const results = await Promise.all(files.map(async (file) => {
      // Always save to GCS so LiveView can reference the URL later
      uploadToGCS(file.path, file.filename).catch(() => {});
      const url = `/api/files/${file.filename}`;
      const originalName = decodeOriginalName(file.originalname);

      const ext = path.extname(originalName).toLowerCase();
      const mimeType = ocrMime[ext];
      if (!mimeType) {
        return { name: originalName, url, ocrText: null, error: 'OCR非対応のファイル形式です（PDF・画像のみ対応）' };
      }
      try {
        const data = fs.readFileSync(file.path).toString('base64');
        const ocrPrompt = [{
          role: 'user' as const,
          parts: [
            { text: 'このファイルに含まれるテキストをすべて抽出してください。表、リスト、数値を含めて内容を正確に再現してください。' },
            { inlineData: { mimeType, data } }
          ]
        }];
        let ocrRes: any;
        for (const m of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001']) {
          try {
            ocrRes = await ai.models.generateContent({ model: m, contents: ocrPrompt });
            break;
          } catch (modelErr: any) {
            if (modelErr?.status === 404 || modelErr?.code === 404) continue;
            throw modelErr;
          }
        }
        return { name: originalName, url, ocrText: ocrRes?.text || '' };
      } catch (err: any) {
        return { name: originalName, url, ocrText: null, error: `OCRエラー: ${err.message}` };
      }
    }));

    res.json({ results });
  });

  function validateAscii(value: string, name: string): void {
    if (!value) return;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) {
        throw new Error(`${name}に無効な文字（日本語などの全角文字）が含まれています。設定画面で正しい${name}（半角英数字）を入力してください。`);
      }
    }
  }

  // Field codes for the recording app in Kintone. These are the codes the user
  // has actually configured on the app; override via env only if the app is renamed.
  const KFC = {
    transcriptRaw:       process.env.KINTONE_TRANSCRIPT_RAW_FIELD       || '文字起こし_原文',
    transcriptFormatted: process.env.KINTONE_TRANSCRIPT_FORMATTED_FIELD || '文字起こし_整形',
    transcriptTL:        process.env.KINTONE_TRANSCRIPT_TL_FIELD        || '文字起こし_TL',
    summary:             process.env.KINTONE_SUMMARY_FIELD              || '要約_セカンドアクション',
    geminiResult:        process.env.KINTONE_GEMINI_RESULT_FIELD        || 'Gemini生成結果',
    staffUsers:          process.env.KINTONE_STAFF_USERS_FIELD          || '対応者',
    backlink:            process.env.KINTONE_BACKLINK_FIELD             || 'Recordingアプリ_リンク',
    audio:               process.env.KINTONE_AUDIO_FIELD                || '録音データ',
    attachments:         process.env.KINTONE_ATTACHMENT_FIELD           || '添付ファイル',
  };

  // Generate a cleaned/formatted version of a raw transcript. Falls back
  // through the gemini-2.5 → 2.0 → 2.0-001 chain (like the summary helper)
  // and returns null only when the input is empty or every model failed.
  async function generateFormattedText(rawText: string): Promise<string | null> {
    if (!rawText || rawText.trim().length < 10) return null;
    try {
      const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const ai = new GoogleGenAI({ vertexai: true, project, location });
      const prompt = `以下の会話の文字起こしテキストを読みやすく校正・整形してください。

ルール：
・話の流れを意識し、会話の文脈に沿って自然に読めるよう整える
・話題が変わる箇所では必ず1行空けて段落を区切る
・文脈から話者を判別できる場合は「話者A:」「話者B:」のようにラベルを付ける（判別困難な場合は省略）
・同じ話者の連続した発言はまとめる
・明らかな言い間違いや同じ語句の繰り返しは整理する
・日程・金額・数量などは数字で明記し、手順や並列項目は箇条書きを活用する
・前置き・説明は不要。整形済みテキストのみ出力する

【文字起こし原文】
${rawText}`;
      for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001']) {
        try {
          const r = await ai.models.generateContent({ model, contents: prompt });
          const out = r.text?.trim();
          if (out) return out;
        } catch (err: any) {
          if (model === 'gemini-2.0-flash-001') throw err;
          console.warn(`[generateFormattedText] ${model} failed, falling back:`, err?.message || err);
        }
      }
      return null;
    } catch (err: any) {
      console.warn('[generateFormattedText] error:', err?.message || err);
      return null;
    }
  }

  // Generate the AI meeting-notes summary. Shared by /api/kintone/sync (initial)
  // and /api/summary/regenerate (user prompts a revision). Returns just the text;
  // any AI errors bubble up as an inline "(AI要約生成エラー: …)" string so the
  // caller can still write something to Firestore.
  async function generateSummary(opts: {
    text: string;
    createdAt?: number;
    customerName?: string;
    participants?: string[];
    attachmentsList: Array<{ name: string; ocrText?: string | null }>;
    extraInstruction?: string;
  }): Promise<string> {
    if (!opts.text || opts.text.trim().length === 0) {
      return '（音声文字起こしデータがないため、要約を作成できませんでした）';
    }
    try {
      const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const ai = new GoogleGenAI({ vertexai: true, project, location });

      const ocrTexts = opts.attachmentsList
        .filter(a => a.ocrText)
        .map(a => `【${a.name}（OCR）】\n${a.ocrText}`)
        .join('\n\n');

      const participantsArray: string[] = Array.isArray(opts.participants) ? opts.participants : [];
      const tbParticipants = participantsArray.filter(p => TAX_BRAIN_MEMBER_SET.has(p));
      const clientParticipants = participantsArray.filter(p => !TAX_BRAIN_MEMBER_SET.has(p));

      const meetingDate = opts.createdAt
        ? new Date(opts.createdAt).toLocaleString('ja-JP', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
          })
        : '（不明）';

      const ocrSection = ocrTexts
        ? `\n【添付資料の参照データ（OCRテキスト）- 議事録本文には転載せず「ファイル内容」セクションの要約にのみ活用すること】\n${ocrTexts}\n`
        : '';
      const fileListNote = opts.attachmentsList.length > 0
        ? `\n【添付ファイル一覧】${opts.attachmentsList.map(a => `\n・${a.name}`).join('')}\n`
        : '';
      const extra = opts.extraInstruction && opts.extraInstruction.trim().length > 0
        ? `\n\n【追加の指示（ユーザー入力・最優先で反映）】\n${opts.extraInstruction.trim()}\n`
        : '';

      const prompt = `以下の顧問先との打合せ記録から議事録を作成してください。

【打合せ情報】
顧問先名：${opts.customerName || '（不明）'}
日時：${meetingDate}
社内担当者（タックスブレーン）：${tbParticipants.length > 0 ? tbParticipants.join('、') : '（不明）'}　※録音者は必ずタックスブレーン社員（社内）です
社外参加者（顧問先・お客様）：${clientParticipants.length > 0 ? clientParticipants.join('、') : 'なし'}　※「参加者」に入力された社外の方です

【文字起こし】
${opts.text}
${ocrSection}${fileListNote}${extra}
常体（だ・である調）で下記の形式のみ出力してください：

## 議題
（この打合せの主なテーマを1〜3行で簡潔に）

## 内容・決定事項
（議論した内容と決定事項を箇条書きで。数字・日付・固有名詞は正確に記載。話題が変わるときは1行空けること）

## 宿題・アクション
（誰が・何を・いつまでに行うか。該当なければ「なし」）

## 次回打合せ予定
（日程や目的が言及されていれば記載。なければ「未定」）

## ファイル内容
（添付ファイルがあれば、各ファイルが何の資料かを1行ずつ簡潔に。詳細な転記は不要。添付なければ「なし」）

注意：会話の流れを重視し重要な発言は省略しないこと。話題が切り替わるときは必ず1行空けること。日程・金額・数量は数字で正確に記載し、手順や並列項目は箇条書きを活用すること。添付資料の内容は「ファイル内容」セクションにのみ記載し、他のセクションには含めないこと。`;

      for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001']) {
        try {
          const r = await ai.models.generateContent({ model, contents: prompt });
          return r.text || '';
        } catch (err: any) {
          if (model === 'gemini-2.0-flash-001') throw err;
          console.warn(`[generateSummary] ${model} failed, falling back:`, err?.message || err);
        }
      }
      return '';
    } catch (err: any) {
      console.error('[generateSummary]', err);
      return `（AI要約生成エラー: ${err?.message || '不明なエラー'}）`;
    }
  }

  // Turn timed transcription lines into a plain-text block for the TL field.
  function timedLinesToText(lines: Array<{ ms: number; text: string }> | undefined): string {
    if (!lines || lines.length === 0) return '';
    return lines.map(l => {
      const m = String(Math.floor(l.ms / 60000)).padStart(2, '0');
      const s = String(Math.floor((l.ms % 60000) / 1000)).padStart(2, '0');
      return `${m}:${s}  ${l.text}`;
    }).join('\n');
  }


  // ── CRM sync (public demo) ─────────────────────────────────────────────────
  // External CRM (Kintone) integration is intentionally DISABLED in this public
  // demo. We still generate the AI summary / formatted transcript, then return a
  // mock success so the UI can show a "CRM へ API 送信できました" completion status
  // without contacting any external system.
  app.post('/api/kintone/sync', async (req, res) => {
    const { text, formattedText, createdAt, customerName, participants,
      attachments: attachmentsParam, attachmentUrl, attachmentName,
      extraInstruction } = req.body;

    const attachmentsList: Array<{ url: string; name: string; ocrText?: string | null }> =
      Array.isArray(attachmentsParam) ? attachmentsParam :
      (attachmentUrl ? [{ url: attachmentUrl, name: attachmentName || '', ocrText: null }] : []);

    try {
      // Best-effort AI summary (never blocks the mock CRM success).
      let summaryText = '';
      try {
        summaryText = await generateSummary({
          text: text || '',
          createdAt,
          customerName,
          participants,
          attachmentsList,
          extraInstruction: extraInstruction || undefined,
        });
      } catch (e: any) {
        console.warn('[sync/demo] summary generation failed (non-fatal):', e?.message || e);
      }

      // Mock CRM record identifiers — no external system is contacted.
      const demoRecordId = `DEMO-${Date.now()}`;
      res.json({
        success: true,
        demo: true,
        summary: summaryText,
        recordId: demoRecordId,
        recordUrl: null,
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'CRM 送信処理でエラーが発生しました' });
    }
  });

  // ── CRM customer lookup (public demo) ──────────────────────────────────────
  // Returns a fixed list of fictional companies instead of querying any external
  // CRM. The client can also type a company name directly.
  app.post('/api/kintone/customers', async (req, res) => {
    const { keyword } = req.body || {};
    const DEMO_CUSTOMERS = [
      { id: '1',  name: '株式会社さくら商事',       number: 'C-1001', submitNo: 'S-1001' },
      { id: '2',  name: '株式会社みらいテック',     number: 'C-1002', submitNo: 'S-1002' },
      { id: '3',  name: '有限会社山田製作所',       number: 'C-1003', submitNo: 'S-1003' },
      { id: '4',  name: '株式会社青空フーズ',       number: 'C-1004', submitNo: 'S-1004' },
      { id: '5',  name: '株式会社ひまわり不動産',   number: 'C-1005', submitNo: 'S-1005' },
      { id: '6',  name: '株式会社北斗ロジスティクス', number: 'C-1006', submitNo: 'S-1006' },
      { id: '7',  name: '医療法人明和クリニック',   number: 'C-1007', submitNo: 'S-1007' },
      { id: '8',  name: '株式会社大和デザイン',     number: 'C-1008', submitNo: 'S-1008' },
      { id: '9',  name: '株式会社緑川建設',         number: 'C-1009', submitNo: 'S-1009' },
      { id: '10', name: '株式会社星野トレーディング', number: 'C-1010', submitNo: 'S-1010' },
    ];
    const kw = (keyword || '').trim();
    const customers = kw
      ? DEMO_CUSTOMERS.filter(c => c.name.includes(kw) || c.number.includes(kw))
      : DEMO_CUSTOMERS;
    res.json({ success: true, customers });
  });

  // ── CRM default settings (public demo) ─────────────────────────────────────
  // Demo placeholders so the client treats CRM as "configured" and enables the
  // send action. No real credentials are used anywhere.
  app.get('/api/kintone/default-settings', (_req, res) => {
    res.json({
      domain: 'demo',
      appId: '1',
      apiToken: 'demo',
      customerAppId: '1',
      customerApiToken: 'demo',
      customerNameField: '顧客名',
      customerNumberField: '顧客番号',
      customerSubmitField: 'submit_No',
      lookupFieldCode: '顧客DBより',
      staffFieldCode: '',
    });
  });

  // ── Live Sync AI Assistant ────────────────────────────────────────────────
  // ライブ同期画面で特定ワードを検知した際に、Geminiが並行して調査を行うためのAPI。
  // extract-task: 文字起こしから調査タスクを抽出
  // chat: Web検索グラウンディング + 現在／過去の文字起こしを踏まえた回答生成
  const ASSISTANT_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001'];

  function createVertexAI(): GoogleGenAI {
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
    const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  async function assistantGenerate(ai: GoogleGenAI, request: { contents: any; config?: any }) {
    let lastError: any = null;
    for (const model of ASSISTANT_MODEL_CHAIN) {
      try {
        return await ai.models.generateContent({ model, ...request });
      } catch (err: any) {
        console.warn(`[assistant] ${model} failed:`, err?.message || err);
        lastError = err;
      }
    }
    throw lastError || new Error('All Gemini models failed');
  }

  app.post('/api/assistant/extract-task', async (req, res) => {
    try {
      const { transcript, triggerWord } = req.body;
      if (!transcript || !triggerWord) {
        return res.status(400).json({ error: 'transcript と triggerWord は必須です。' });
      }

      const ai = createVertexAI();
      const prompt = `あなたは会議アシスタントです。以下の会議の文字起こしの中で、話者が「${triggerWord}」と発言しました。
その発言の直前までの会話の流れから、話者が「調べておく」と言った調査タスク（調べるべき事項・質問）を1つ抽出してください。

出力ルール:
- タスク内容のみを、簡潔な日本語（1〜2文）で出力する
- 前置きや見出し、記号は付けない

文字起こし:
"${String(transcript).slice(-6000)}"`;

      const response = await assistantGenerate(ai, { contents: prompt });
      const task = (response.text || '').trim();
      if (!task) throw new Error('調査タスクを抽出できませんでした。');
      res.json({ task });
    } catch (error: any) {
      console.error('[/api/assistant/extract-task]', error);
      res.status(500).json({ error: error?.message || '調査タスクの抽出に失敗しました。' });
    }
  });

  app.post('/api/assistant/detect-intent', async (req, res) => {
    try {
      const { transcript } = req.body;
      const text = String(transcript || '').trim();
      if (text.length < 60) return res.json({ needsInvestigation: false });

      const ai = createVertexAI();
      const snippet = text.slice(-1200);
      const prompt = `以下は税理士と顧客の会議の文字起こしの直近部分です。
専門的な調査・情報収集が必要な場面かどうかを判断してください。

調査が必要な例:
- 顧客が税務・法律・会計・制度・手続きについて質問している
- 担当者が「調べます」「確認します」「後で調べておきます」などと言っている
- 具体的な金額・期限・要件を確認する必要がある話題が出ている

調査不要な例:
- 雑談・世間話
- すでに回答済みで話が完結している

文字起こし（直近部分）:
${snippet}

「YES」または「NO」のみで回答してください。`;

      const response = await assistantGenerate(ai, { contents: prompt });
      const answer = (response.text || '').trim().toUpperCase();
      res.json({ needsInvestigation: answer.startsWith('YES') });
    } catch (error: any) {
      console.error('[/api/assistant/detect-intent]', error);
      res.json({ needsInvestigation: false });
    }
  });

  app.post('/api/assistant/chat', async (req, res) => {
    try {
      const { messages, transcript, pastTranscripts } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages は必須です。' });
      }

      let pastText = '（なし）';
      let hasPastRecords = false;
      if (Array.isArray(pastTranscripts) && pastTranscripts.length > 0) {
        hasPastRecords = true;
        pastText = pastTranscripts
          .slice(0, 5)
          .map((r: any) => {
            const date = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '不明';
            const body = String(r.summary || r.text || '').slice(0, 1500);
            return `■ ${r.title || '無題'}（${date}）\n${body}`;
          })
          .join('\n\n');
      }

      const systemInstruction = `あなたは会議中に並行して調査・振り返りを行う優秀なAIアシスタントです。
会議の参加者が「調べておきます」と言った事項を代わりに調査し、日本語で簡潔かつ具体的に回答してください。
必要に応じてWeb検索を活用し、以下の参考情報（現在の会議の文字起こし・過去の文字起こし）も踏まえて推論してください。
ユーザーからの追加の質問や指示には、それまでの対話の文脈を踏まえて回答を改善してください。

${hasPastRecords ? `【重要】「あれってどうしましたっけ？」「前回どうなりましたか？」「以前の話では？」など過去への振り返り質問が来た場合は、必ず下記の「同一顧問先の過去記録」を参照して回答してください。` : ''}

【現在の会議の文字起こし（最新部分）】
${String(transcript || '').slice(-6000) || '（なし）'}

【同一顧問先の過去の商談・打ち合わせ記録（振り返り参考情報）】
${pastText}`;

      const contents = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }]
      }));

      const ai = createVertexAI();

      // まずWeb検索グラウンディング有効で試す。リージョン/モデル/権限の都合で
      // googleSearchツールが使えない環境ではツール無しで再試行する（フォールバック）。
      let response: any;
      try {
        response = await assistantGenerate(ai, {
          contents,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
          },
        });
      } catch (err: any) {
        console.warn('[/api/assistant/chat] googleSearch tool unavailable, retrying without tools:', err?.message);
        response = await assistantGenerate(ai, {
          contents,
          config: { systemInstruction },
        });
      }

      const reply = (response.text || '').trim();
      if (!reply) throw new Error('回答を生成できませんでした。');

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks
        .map((chunk: any) => ({
          title: chunk?.web?.title || '',
          uri: chunk?.web?.uri || ''
        }))
        .filter((s: any) => s.uri);

      res.json({ reply, sources });
    } catch (error: any) {
      console.error('[/api/assistant/chat]', error);
      res.status(500).json({ error: error?.message || '回答の生成に失敗しました。' });
    }
  });

  // ── AI File Rename ────────────────────────────────────────────────────────
  app.post('/api/rename-file', async (req, res) => {
    const { filename, ocrText } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });

    const ext = path.extname(filename);
    const context = ocrText
      ? `OCRテキスト（先頭2000文字）:\n${String(ocrText).slice(0, 2000)}`
      : `元のファイル名: ${filename}`;
    const todayStr = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo'
    }).replace(/\//g, '.'); // yyyy.mm.dd
    const prompt = `以下のファイルの内容に基づき、日本語で分かりやすいファイル名を提案してください（拡張子は付けない）。
本日の日付（参考・推定用）: ${todayStr}

【ファイル名の構成】
原則 "日付_書類名_相手先名_金額_その他記載した方がよい事項" の順で構成する（該当しない要素は省略してよい）。
※試算表・推移表などの財務資料の場合は、資料のタイトルと対象期間がわかるようにし、金額はファイル名に抽出しない。

【日付のルール】
・日付は yyyy/mm/dd 形式にし、区切りの「/」は「.」に置き換える（例: 2026.01.01）。
・日付を取得するときは、請求日 → 納品日 → 作成日 の順で探して採用する。
・和暦（令和・平成など）で書かれている場合は西暦に変換する。
・OCR結果の日付が本日から1年以上前後している場合は誤読の可能性が高いので、内容から再検証する。
・年が書かれていない/不明な場合は、本日から1か月前の時点の年で推定する（例: 本日が2026年1月10日なら2025年）。

【表記統一のルール】
・要素ごとの区切り文字は「_」（半角アンダーバー）で統一する。
・カタカナは全角、英数字は半角で統一する。
・伸ばし棒は「ー」（U+30FC）に統一する（✕ - ― － – —、○ ー）。
・スペースは入れない（排除する）。
・株式会社→㈱、有限会社→㈲、合同会社→(同)、その他の商号は半角括弧で括った一般的な略称にする。
・請求書・見積書・契約書などから読み取った金額は「￥」を排除し、カンマ区切りの「円」表示にする（例: 1,200,000円）。
・ファイル名として使えない文字（/ \\ : * ? " < > |）は使わない。

${context}

提案するファイル名（拡張子なし）のみを1行で出力し、説明は不要です。`;

    try {
      const ai = new GoogleGenAI({ vertexai: true, project: 'it-kadai', location: 'asia-northeast1' });
      let resp: any;
      try {
        resp = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      } catch {
        resp = await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt });
      }
      const firstLine = (resp.text || '').trim().split('\n').map(s => s.trim()).find(Boolean) || '';
      const suggested = firstLine.replace(/[/\\:*?"<>|]/g, '').slice(0, 120);
      res.json({ suggested: suggested ? suggested + ext : filename });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'AI rename failed' });
    }
  });

  // ── AI-summary regenerate / save ──────────────────────────────────────────
  // PUT-update the Kintone 要約_セカンドアクション field on an existing record.
  // Returns true on success, false if credentials were missing or the PUT failed.
  async function updateKintoneSummary(opts: {
    domain?: string; appId?: string; apiToken?: string; kintoneRecordId?: string; summary: string;
  }): Promise<boolean> {
    // Public demo: external CRM integration is disabled. No PUT is sent; the
    // caller treats a false result as "CRM not updated" (Firestore still saves).
    void opts;
    return false;
  }

  // Regenerate the AI summary with an extra user prompt, then update Kintone
  // (best-effort). The client writes the returned summary to Firestore itself.
  app.post('/api/summary/regenerate', async (req, res) => {
    try {
      const { prompt, user,
        text, createdAt, customerName, participants,
        attachments: attachmentsParam, attachmentUrl, attachmentName,
        kintoneRecordId, domain, appId, apiToken } = req.body;

      const attachmentsList: Array<{ name: string; ocrText?: string | null }> =
        Array.isArray(attachmentsParam) ? attachmentsParam :
        (attachmentUrl ? [{ name: attachmentName || '', ocrText: null }] : []);

      const summary = await generateSummary({
        text: text || '',
        createdAt,
        customerName,
        participants,
        attachmentsList,
        extraInstruction: prompt,
      });

      let kintoneUpdated = false;
      if (kintoneRecordId) {
        kintoneUpdated = await updateKintoneSummary({ domain, appId, apiToken, kintoneRecordId, summary });
      }

      console.log(`[/api/summary/regenerate] by ${user || '?'} — kintoneUpdated=${kintoneUpdated}`);
      res.json({ summary, kintoneUpdated });
    } catch (e: any) {
      console.error('[/api/summary/regenerate]', e);
      res.status(500).json({ error: e?.message || 'regenerate failed' });
    }
  });

  // Save a user-edited summary verbatim to Kintone (best-effort). Client also
  // writes to Firestore + appends an updateLog entry.
  app.post('/api/summary/save', async (req, res) => {
    try {
      const { summary, user, kintoneRecordId, domain, appId, apiToken } = req.body;
      if (typeof summary !== 'string') return res.status(400).json({ error: 'summary required' });

      let kintoneUpdated = false;
      if (kintoneRecordId) {
        kintoneUpdated = await updateKintoneSummary({ domain, appId, apiToken, kintoneRecordId, summary });
      }
      console.log(`[/api/summary/save] by ${user || '?'} — kintoneUpdated=${kintoneUpdated}`);
      res.json({ kintoneUpdated });
    } catch (e: any) {
      console.error('[/api/summary/save]', e);
      res.status(500).json({ error: e?.message || 'save failed' });
    }
  });

  // ── Beta Feedback AI Chat ─────────────────────────────────────────────────
  app.post('/api/beta/chat', async (req, res) => {
    try {
      const { messages, userEmail } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages required' });
      }

      const project = process.env.GOOGLE_CLOUD_PROJECT || 'it-kadai';
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const ai = new GoogleGenAI({ vertexai: true, project, location });

      const systemPrompt = `あなたは「レコーディングアプリ」のベータ版フィードバック収集AIアシスタントです。

【アプリの機能概要】
このアプリは税理士法人タックスブレーンが社内で使用する会議録音・文字起こしアプリです。
主な機能：
・音声録音と自動文字起こし（Gemini AI使用）
・複数デバイス間のリアルタイム同期（ライブ同期機能）
・Kintoneとの連携（顧客情報ルックアップ・議事録自動同期）
・AI要約の自動生成・手動編集・再生成
・添付ファイルのアップロード・OCR・プレビュー
・顧客番号による顧問先検索
・参加者（社内・社外）の管理
・録音履歴の検索・フィルタリング
・ダークモード・文字サイズ設定

【録音の使い方】
1. 「録音」タブで録音ボタンを押して録音開始
2. 顧客番号で顧問先をルックアップ（Kintone連携）
3. 参加者を追加（社内メンバーはリストから選択）
4. 必要に応じて添付ファイルをアップロード（PDF・画像のOCR対応）
5. 録音停止後、自動で文字起こし・整形・AI要約が生成
6. Kintoneに自動同期

【ライブ同期の使い方】
・別のデバイスで録音中のセッションに参加できる
・セッションIDで接続し、リアルタイムで顧客情報や添付ファイルを共有
・iOSからブラウザの録音セッションに参加可能

【あなたの役割】
1. ユーザーのフィードバックを聞き、理解する
2. ユーザーが機能の使い方を誤解している場合は、正しい使い方を丁寧に説明する
3. 使い方の説明で解決する問題と、本当に改善が必要な問題を区別する
4. 本当に改善が必要なフィードバックについては、具体的に掘り下げて解像度を最大限に高める
5. 最終的に、改善提案として保存すべき内容を明確にまとめる

【会話のルール】
・日本語で応答する
・フレンドリーで丁寧な口調
・「それは〇〇機能で既に可能です」と案内できる場合は、まずそれを伝える
・改善が必要と判断した場合は追加の質問は1〜2個以内に抑え、2〜3ターンでフィードバックをまとめる
・1回の応答は150文字以内に収める（簡潔に）
・フィードバックの概要が掴めたら、必ず次の文言で確認する：「これは、現状の機能では対応しておらず、ぜひ改善が必要な点だと理解いたしました。この内容でフィードバックとして保存しましょうか？」
・上記確認の際は、レビュータイトルと詳細説明を「===SAVE_REVIEW===」マーカーの後にJSON形式で出力する
  例: ===SAVE_REVIEW==={"title":"〇〇機能の改善","description":"詳細な説明..."}
・ユーザーが「OK」と答えたら「ありがとうございます！フィードバックを保存しました。他に気になる点があればお知らせください。」と答える
・ユーザーが「保存して別のフィードバックを続ける」と答えたら「承知しました！では次のフィードバックを教えてください。」と答える`;

      const contents = [
        { role: 'user' as const, parts: [{ text: systemPrompt + '\n\n以下がユーザーとの会話履歴です。最後のユーザーメッセージに応答してください。' }] },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role === 'user' ? 'user' as const : 'model' as const,
          parts: [{ text: m.content }],
        })),
      ];

      let reply = '';
      for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001']) {
        try {
          const r = await ai.models.generateContent({ model, contents });
          reply = r.text || '';
          break;
        } catch (err: any) {
          if (model === 'gemini-2.0-flash-001') throw err;
          console.warn(`[/api/beta/chat] ${model} failed, falling back:`, err?.message);
        }
      }

      const saveMatch = reply.match(/===SAVE_REVIEW===([\s\S]*?)$/);
      let saveData: { title: string; description: string } | null = null;
      let displayReply = reply;
      if (saveMatch) {
        try {
          saveData = JSON.parse(saveMatch[1].trim());
          displayReply = reply.replace(/===SAVE_REVIEW===[\s\S]*$/, '').trim();
        } catch {}
      }

      console.log(`[/api/beta/chat] user=${userEmail || '?'}, msgs=${messages.length}, save=${!!saveData}`);
      res.json({ reply: displayReply, saveData });
    } catch (e: any) {
      console.error('[/api/beta/chat]', e);
      res.status(500).json({ error: e?.message || 'chat failed' });
    }
  });

  // Fetch all beta reviews (for the weekly review trigger or admin dashboard)
  app.get('/api/beta/reviews', async (_req, res) => {
    res.json({ message: 'Reviews are managed client-side via Firestore' });
  });

  if (process.env.NODE_ENV !== "production") {
    console.log('[Server] Initializing Vite development server...');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: [
          'localhost',
          '127.0.0.1',
          'recording-app-622337019239.asia-northeast1.run.app',
        ],
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log('[Server] Serving static files from dist/ (production mode)');
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
