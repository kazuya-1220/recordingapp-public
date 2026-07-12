var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_vite = require("vite");
var import_http = require("http");
var import_multer = __toESM(require("multer"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_genai = require("@google/genai");
var PORT = 3e3;
var UPLOADS_DIR = import_path.default.join(process.cwd(), "uploads");
if (!import_fs.default.existsSync(UPLOADS_DIR)) {
  import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
}
var upload = (0, import_multer.default)({ dest: UPLOADS_DIR });
async function startServer() {
  const app = (0, import_express.default)();
  const httpServer = (0, import_http.createServer)(app);
  app.use(import_express.default.json());
  app.use("/uploads", import_express.default.static(UPLOADS_DIR));
  app.post("/api/recordings", upload.single("audio"), (req, res) => {
    const file = req.file;
    res.json({
      audioUrl: file ? `/uploads/${file.filename}` : null
    });
  });
  function createGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new import_genai.GoogleGenAI({ apiKey });
  }
  const GEMINI_MODEL_CHAIN = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest"];
  async function generateWithFallback(ai, request) {
    let lastError = null;
    for (const model of GEMINI_MODEL_CHAIN) {
      try {
        return await ai.models.generateContent({ model, ...request });
      } catch (err) {
        console.warn(`${model} failed or busy. Trying next model...`, err?.message || err);
        lastError = err;
      }
    }
    throw lastError || new Error("All Gemini models failed");
  }
  app.post("/api/assistant/extract-task", async (req, res) => {
    const { transcript, triggerWord } = req.body;
    if (!transcript || !triggerWord) {
      return res.status(400).json({ error: "transcript \u3068 triggerWord \u306F\u5FC5\u9808\u3067\u3059\u3002" });
    }
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(500).json({ error: "GEMINI_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" });
    }
    const prompt = `\u3042\u306A\u305F\u306F\u4F1A\u8B70\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002\u4EE5\u4E0B\u306E\u4F1A\u8B70\u306E\u6587\u5B57\u8D77\u3053\u3057\u306E\u4E2D\u3067\u3001\u8A71\u8005\u304C\u300C${triggerWord}\u300D\u3068\u767A\u8A00\u3057\u307E\u3057\u305F\u3002
\u305D\u306E\u767A\u8A00\u306E\u76F4\u524D\u307E\u3067\u306E\u4F1A\u8A71\u306E\u6D41\u308C\u304B\u3089\u3001\u8A71\u8005\u304C\u300C\u8ABF\u3079\u3066\u304A\u304F\u300D\u3068\u8A00\u3063\u305F\u8ABF\u67FB\u30BF\u30B9\u30AF\uFF08\u8ABF\u3079\u308B\u3079\u304D\u4E8B\u9805\u30FB\u8CEA\u554F\uFF09\u30921\u3064\u62BD\u51FA\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u51FA\u529B\u30EB\u30FC\u30EB:
- \u30BF\u30B9\u30AF\u5185\u5BB9\u306E\u307F\u3092\u3001\u7C21\u6F54\u306A\u65E5\u672C\u8A9E\uFF081\u301C2\u6587\uFF09\u3067\u51FA\u529B\u3059\u308B
- \u524D\u7F6E\u304D\u3084\u898B\u51FA\u3057\u3001\u8A18\u53F7\u306F\u4ED8\u3051\u306A\u3044

\u6587\u5B57\u8D77\u3053\u3057:
"${String(transcript).slice(-6e3)}"`;
    try {
      const response = await generateWithFallback(ai, { contents: prompt });
      const task = (response.text || "").trim();
      if (!task) {
        throw new Error("\u8ABF\u67FB\u30BF\u30B9\u30AF\u3092\u62BD\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      }
      res.json({ task });
    } catch (error) {
      console.error("Assistant extract-task error:", error);
      res.status(500).json({ error: error.message || "\u8ABF\u67FB\u30BF\u30B9\u30AF\u306E\u62BD\u51FA\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" });
    }
  });
  app.post("/api/assistant/chat", async (req, res) => {
    const { messages, transcript, pastTranscripts } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages \u306F\u5FC5\u9808\u3067\u3059\u3002" });
    }
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(500).json({ error: "GEMINI_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" });
    }
    let pastText = "\uFF08\u306A\u3057\uFF09";
    if (Array.isArray(pastTranscripts) && pastTranscripts.length > 0) {
      pastText = pastTranscripts.slice(0, 5).map((r) => {
        const date = r.createdAt ? new Date(r.createdAt).toISOString().split("T")[0] : "\u4E0D\u660E";
        const body = String(r.summary || r.text || "").slice(0, 1500);
        return `\u25A0 ${r.title || "\u7121\u984C"}\uFF08${date}\uFF09
${body}`;
      }).join("\n\n");
    }
    const systemInstruction = `\u3042\u306A\u305F\u306F\u4F1A\u8B70\u4E2D\u306B\u4E26\u884C\u3057\u3066\u8ABF\u67FB\u3092\u884C\u3046\u512A\u79C0\u306AAI\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002
\u4F1A\u8B70\u306E\u53C2\u52A0\u8005\u304C\u300C\u8ABF\u3079\u3066\u304A\u304D\u307E\u3059\u300D\u3068\u8A00\u3063\u305F\u4E8B\u9805\u3092\u4EE3\u308F\u308A\u306B\u8ABF\u67FB\u3057\u3001\u65E5\u672C\u8A9E\u3067\u7C21\u6F54\u304B\u3064\u5177\u4F53\u7684\u306B\u56DE\u7B54\u3057\u3066\u304F\u3060\u3055\u3044\u3002
\u5FC5\u8981\u306B\u5FDC\u3058\u3066Web\u691C\u7D22\u3092\u6D3B\u7528\u3057\u3001\u4EE5\u4E0B\u306E\u53C2\u8003\u60C5\u5831\uFF08\u73FE\u5728\u306E\u4F1A\u8B70\u306E\u6587\u5B57\u8D77\u3053\u3057\u30FB\u904E\u53BB\u306E\u6587\u5B57\u8D77\u3053\u3057\uFF09\u3082\u8E0F\u307E\u3048\u3066\u63A8\u8AD6\u3057\u3066\u304F\u3060\u3055\u3044\u3002
\u30E6\u30FC\u30B6\u30FC\u304B\u3089\u306E\u8FFD\u52A0\u306E\u8CEA\u554F\u3084\u6307\u793A\u306B\u306F\u3001\u305D\u308C\u307E\u3067\u306E\u5BFE\u8A71\u306E\u6587\u8108\u3092\u8E0F\u307E\u3048\u3066\u56DE\u7B54\u3092\u6539\u5584\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u3010\u73FE\u5728\u306E\u4F1A\u8B70\u306E\u6587\u5B57\u8D77\u3053\u3057\uFF08\u6700\u65B0\u90E8\u5206\uFF09\u3011
${String(transcript || "").slice(-6e3) || "\uFF08\u306A\u3057\uFF09"}

\u3010\u904E\u53BB\u306E\u6587\u5B57\u8D77\u3053\u3057\u30FB\u8B70\u4E8B\u9332\u3011
${pastText}`;
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }]
    }));
    try {
      const response = await generateWithFallback(ai, {
        contents,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }]
        }
      });
      const reply = (response.text || "").trim();
      if (!reply) {
        throw new Error("\u56DE\u7B54\u3092\u751F\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      }
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks.map((chunk) => ({
        title: chunk?.web?.title || "",
        uri: chunk?.web?.uri || ""
      })).filter((s) => s.uri);
      res.json({ reply, sources });
    } catch (error) {
      console.error("Assistant chat error:", error);
      res.status(500).json({ error: error.message || "\u56DE\u7B54\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" });
    }
  });
  function validateAscii(value, name) {
    if (!value) return;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) {
        throw new Error(`${name}\u306B\u7121\u52B9\u306A\u6587\u5B57\uFF08\u65E5\u672C\u8A9E\u306A\u3069\u306E\u5168\u89D2\u6587\u5B57\uFF09\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u3002\u8A2D\u5B9A\u753B\u9762\u3067\u6B63\u3057\u3044${name}\uFF08\u534A\u89D2\u82F1\u6570\u5B57\uFF09\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
      }
    }
  }
  function toRichText(plain) {
    if (!plain) return "";
    return plain.split("\n").map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "&nbsp;"}</p>`).join("");
  }
  app.post("/api/kintone/sync", async (req, res) => {
    const { domain, appId, apiToken, title, text, createdAt, audioUrl, customerNumber, customerName, participants, geminiResult } = req.body;
    if (!domain || !appId || !apiToken) {
      return res.status(400).json({ error: "Missing Kintone configuration." });
    }
    const cleanDomain = domain.trim().replace(/^(https?:\/\/)/i, "").replace(/\/+$/, "");
    try {
      validateAscii(apiToken, "API\u30C8\u30FC\u30AF\u30F3");
      validateAscii(cleanDomain, "\u30B5\u30D6\u30C9\u30E1\u30A4\u30F3");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      let summaryText = "";
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && text && text.trim().length > 0) {
          const ai = new import_genai.GoogleGenAI({ apiKey });
          console.log("Generating summary and second actions using gemini-3.5-flash...");
          const prompt = `\u3042\u306A\u305F\u306F\u512A\u79C0\u306A\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002\u63D0\u4F9B\u3055\u308C\u305F\u97F3\u58F0\u6587\u5B57\u8D77\u3053\u3057\u30C6\u30AD\u30B9\u30C8\u304B\u3089\u3001\u6B21\u306E2\u3064\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u65E5\u672C\u8A9E\u3067\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002

1. \u4F1A\u8A71\u5185\u5BB9\u306E\u8981\u7D04\uFF08\u65E5\u672C\u8A9E\u3067100\u6587\u5B57\u7A0B\u5EA6\u3001\u7C21\u6F54\u3067\u898B\u3084\u3059\u3044\u307E\u3068\u3081\uFF09
2. \u4ECA\u5F8C\u306E\u5177\u4F53\u7684\u306A\u30A2\u30AF\u30B7\u30E7\u30F3\uFF08\u30BB\u30AB\u30F3\u30C9\u30A2\u30AF\u30B7\u30E7\u30F3\uFF09\u3084\u4F55\u304B\u3057\u3089\u306E\u30A2\u30AF\u30B7\u30E7\u30F3\u304C\u5FC5\u8981\u304C\u3042\u308B\u5185\u5BB9\u30FBToDo\u4E8B\u9805

\u51FA\u529B\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u306F\u4EE5\u4E0B\u306E\u3088\u3046\u306B\u3001\u898B\u51FA\u3057\u3092\u3064\u3051\u3066\u5206\u304B\u308A\u3084\u3059\u304F\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\uFF1A

\u3010\u8981\u7D04\u3011
\uFF08\u3053\u3053\u306B100\u6587\u5B57\u7A0B\u5EA6\u306E\u8981\u7D04\uFF09

\u3010\u30BB\u30AB\u30F3\u30C9\u30A2\u30AF\u30B7\u30E7\u30F3\u3011
\u30FB\uFF08\u30A2\u30AF\u30B7\u30E7\u30F3\u9805\u76EE1\uFF09
\u30FB\uFF08\u30A2\u30AF\u30B7\u30E7\u30F3\u9805\u76EE2\uFF09

\u97F3\u58F0\u6587\u5B57\u8D77\u3053\u3057\u30C6\u30AD\u30B9\u30C8\uFF1A
"${text}"`;
          let geminiResponse;
          try {
            console.log("Generating summary and second actions using gemini-3.5-flash...");
            geminiResponse = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: prompt
            });
          } catch (err) {
            console.warn("gemini-3.5-flash failed or busy. Falling back to gemini-2.5-flash...", err);
            try {
              geminiResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt
              });
            } catch (err2) {
              console.warn("gemini-2.5-flash failed or busy. Falling back to gemini-flash-latest...", err2);
              geminiResponse = await ai.models.generateContent({
                model: "gemini-flash-latest",
                contents: prompt
              });
            }
          }
          summaryText = geminiResponse.text || "";
          console.log("Successfully generated AI summary.");
        } else {
          summaryText = "\uFF08\u97F3\u58F0\u6587\u5B57\u8D77\u3053\u3057\u30C7\u30FC\u30BF\u304C\u306A\u3044\u305F\u3081\u3001\u8981\u7D04\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF09";
        }
      } catch (geminiError) {
        console.error("Gemini API Error:", geminiError);
        summaryText = `\uFF08AI\u8981\u7D04\u751F\u6210\u30A8\u30E9\u30FC: ${geminiError.message || "\u4E0D\u660E\u306A\u30A8\u30E9\u30FC"}\uFF09`;
      }
      let fileKey = null;
      if (audioUrl) {
        const filename = import_path.default.basename(audioUrl);
        const filePath = import_path.default.join(process.cwd(), "uploads", filename);
        if (import_fs.default.existsSync(filePath)) {
          const fileBuffer = import_fs.default.readFileSync(filePath);
          const fileBlob = new Blob([fileBuffer], { type: "audio/webm" });
          const uploadFormData = new FormData();
          uploadFormData.append("file", fileBlob, `recording_${Date.now()}.webm`);
          const uploadUrl = `https://${cleanDomain}/k/v1/file.json`;
          console.log(`Uploading file to Kintone: ${uploadUrl}`);
          const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "X-Cybozu-API-Token": apiToken
            },
            body: uploadFormData
          });
          const uploadText = await uploadRes.text();
          let uploadData;
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
      const kintoneUrl = `https://${cleanDomain}/k/v1/record.json`;
      let textWithMeta = text || "";
      if (customerNumber || customerName || participants && participants.length > 0) {
        const metaLines = [];
        metaLines.push("\u3010\u6253\u3061\u5408\u308F\u305B\u57FA\u672C\u60C5\u5831\u3011");
        if (customerNumber) metaLines.push(`\u30FB\u9867\u5BA2\u756A\u53F7: ${customerNumber}`);
        if (customerName) metaLines.push(`\u30FB\u9867\u5BA2\u540D: ${customerName}`);
        if (participants && participants.length > 0) {
          const pList = Array.isArray(participants) ? participants.join(", ") : participants;
          metaLines.push(`\u30FB\u51FA\u5E2D\u8005: ${pList}`);
        }
        metaLines.push("---------------------------");
        metaLines.push("");
        textWithMeta = metaLines.join("\n") + textWithMeta;
      }
      const record = {
        Title: { value: title || "\u97F3\u58F0\u5165\u529B\u30C7\u30FC\u30BF" },
        Text: { value: textWithMeta },
        Date: { value: new Date(createdAt).toISOString().split("T")[0] },
        "\u8981\u7D04_\u30BB\u30AB\u30F3\u30C9\u30A2\u30AF\u30B7\u30E7\u30F3": { value: summaryText },
        "Gemini\u751F\u6210\u7D50\u679C": { value: toRichText(geminiResult || "") }
      };
      if (fileKey) {
        record["\u6DFB\u4ED8\u30D5\u30A1\u30A4\u30EB"] = {
          value: [
            { fileKey }
          ]
        };
      }
      const payload = {
        app: parseInt(appId, 10),
        record
      };
      console.log(`Creating Kintone record at: ${kintoneUrl}`);
      const kintoneRes = await fetch(kintoneUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cybozu-API-Token": apiToken
        },
        body: JSON.stringify(payload)
      });
      const kintoneText = await kintoneRes.text();
      let kintoneData;
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
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error communicating with Kintone" });
    }
  });
  app.post("/api/kintone/customers", async (req, res) => {
    const { domain, customerAppId, customerApiToken, keyword, nameField = "\u9867\u5BA2\u540D", numberField = "\u9867\u5BA2\u756A\u53F7" } = req.body;
    if (!domain || !customerAppId || !customerApiToken) {
      return res.status(400).json({ error: "Missing Kintone configuration for customer lookup." });
    }
    const cleanDomain = domain.trim().replace(/^(https?:\/\/)/i, "").replace(/\/+$/, "");
    try {
      validateAscii(customerApiToken, "\u9867\u5BA2\u30A2\u30D7\u30EA\u306EAPI\u30C8\u30FC\u30AF\u30F3");
      validateAscii(cleanDomain, "\u30B5\u30D6\u30C9\u30E1\u30A4\u30F3");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const kintoneUrl = `https://${cleanDomain}/k/v1/records.json`;
    let query = "";
    const cleanNameField = nameField.trim() || "\u9867\u5BA2\u540D";
    const cleanNumberField = numberField.trim() || "\u9867\u5BA2\u756A\u53F7";
    if (keyword && keyword.trim().length > 0) {
      const escapedKeyword = keyword.trim().replace(/"/g, '\\"');
      query = `(${cleanNameField} like "${escapedKeyword}" or ${cleanNumberField} like "${escapedKeyword}") order by $id desc limit 50`;
    } else {
      query = "order by $id desc limit 50";
    }
    try {
      console.log(`Fetching Kintone customers from: ${kintoneUrl}?app=${customerAppId}&query=${query}`);
      const response = await fetch(`${kintoneUrl}?app=${customerAppId}&query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: {
          "X-Cybozu-API-Token": customerApiToken
        }
      });
      const text = await response.text();
      let data;
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
      const customers = records.map((rec) => {
        return {
          id: rec.$id?.value || "",
          name: rec[cleanNameField]?.value || "",
          number: rec[cleanNumberField]?.value || ""
        };
      });
      res.json({ success: true, customers });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || "Error fetching customers from Kintone" });
    }
  });
  app.get("/api/kintone/default-settings", (req, res) => {
    res.json({
      domain: process.env.KINTONE_DOMAIN || "",
      appId: process.env.KINTONE_APP_ID || "",
      apiToken: process.env.KINTONE_API_TOKEN || "",
      customerAppId: process.env.KINTONE_CUSTOMER_APP_ID || "",
      customerApiToken: process.env.KINTONE_CUSTOMER_API_TOKEN || "",
      customerNameField: process.env.KINTONE_CUSTOMER_NAME_FIELD || "\u9867\u5BA2\u540D",
      customerNumberField: process.env.KINTONE_CUSTOMER_NUMBER_FIELD || "\u9867\u5BA2\u756A\u53F7"
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(import_express.default.static(import_path.default.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(process.cwd(), "dist", "index.html"));
    });
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
