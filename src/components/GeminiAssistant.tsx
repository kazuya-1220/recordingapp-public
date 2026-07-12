import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Sparkles, Send, Loader2, ExternalLink, Play, Maximize2, Minimize2, ZoomIn, ZoomOut, X, Save, Check } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { ChatMessage, PastTranscript } from '../types';
import {
  fuzzyCountOccurrences,
  detectNeedsInvestigation,
  extractTask,
  fetchPastTranscripts,
  sendAssistantChat,
} from '../lib/assistant';

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg_${Date.now()}_${messageSeq}`;
}

export function GeminiAssistant({
  liveText,
  triggerWord,
  sessionId,
  customerNumber,
  solveRef,
}: {
  liveText: string | null;
  triggerWord: string;
  sessionId?: string;
  customerNumber?: string;
  solveRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const handledCountRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const liveTextRef = useRef('');
  const chatHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const pastTranscriptsRef = useRef<PastTranscript[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const popupScrollRef = useRef<HTMLDivElement>(null);
  const aiCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAiCheckLengthRef = useRef(0);
  const lastAutoTriggerAtRef = useRef(0);

  const pushMessage = (msg: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...msg, id: nextMessageId() }]);
    if (msg.role !== 'system') {
      chatHistoryRef.current.push({ role: msg.role, content: msg.content });
    }
  };

  useEffect(() => {
    for (const ref of [scrollRef, popupScrollRef]) {
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(() => {
    if (liveText === null) return;
    liveTextRef.current = liveText;
    if (!triggerWord) return;

    const count = fuzzyCountOccurrences(liveText, triggerWord);
    if (handledCountRef.current === null) {
      handledCountRef.current = count;
      return;
    }
    if (count > handledCountRef.current) {
      handledCountRef.current = count;
      void runInvestigation();
    }
  }, [liveText, triggerWord]);

  // AI intent detection: debounced + rate-limited auto-trigger
  useEffect(() => {
    if (!liveText || liveText === '待機中...') return;
    if (aiCheckTimerRef.current) clearTimeout(aiCheckTimerRef.current);
    const newLength = liveText.length - lastAiCheckLengthRef.current;
    if (newLength < 150) return;
    aiCheckTimerRef.current = setTimeout(async () => {
      if (busyRef.current) return;
      if (Date.now() - lastAutoTriggerAtRef.current < 3 * 60 * 1000) return;
      lastAiCheckLengthRef.current = liveText.length;
      try {
        const needs = await detectNeedsInvestigation(liveText);
        if (needs && !busyRef.current) {
          lastAutoTriggerAtRef.current = Date.now();
          void runImmediateSolve();
        }
      } catch {}
    }, 15000);
    return () => { if (aiCheckTimerRef.current) clearTimeout(aiCheckTimerRef.current); };
  }, [liveText]);

  // Reset past transcripts cache when customerNumber changes
  useEffect(() => {
    pastTranscriptsRef.current = null;
  }, [customerNumber]);

  const getPastTranscripts = async (): Promise<PastTranscript[]> => {
    if (pastTranscriptsRef.current) return pastTranscriptsRef.current;
    const uid = auth.currentUser?.uid;
    const past = uid ? await fetchPastTranscripts(uid, customerNumber) : [];
    pastTranscriptsRef.current = past;
    return past;
  };

  const requestReply = async () => {
    const transcript = liveTextRef.current.slice(-6000);
    const past = await getPastTranscripts();
    const { reply, sources } = await sendAssistantChat({
      messages: chatHistoryRef.current,
      transcript,
      pastTranscripts: past,
    });
    pushMessage({ role: 'assistant', content: reply, sources });
  };

  const runInvestigation = async () => {
    if (busyRef.current) {
      pushMessage({
        role: 'system',
        content: `特定ワード「${triggerWord}」を検知しましたが、調査実行中のためスキップしました。`,
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    pushMessage({
      role: 'system',
      content: `特定ワード「${triggerWord}」を検知しました。調査タスクを抽出しています...`,
    });
    try {
      const transcript = liveTextRef.current.slice(-6000);
      const task = await extractTask(transcript, triggerWord);
      pushMessage({ role: 'system', content: `調査タスク：${task}` });
      pushMessage({
        role: 'user',
        content: `次の調査タスクについて、Web検索と過去の文字起こしを参考に調査し、回答してください。\n\n調査タスク：${task}`,
      });
      await requestReply();
    } catch (error: any) {
      pushMessage({
        role: 'system',
        content: `調査に失敗しました: ${error.message || '不明なエラー'}`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runImmediateSolve = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    pushMessage({
      role: 'system',
      content: '現在の文字起こしから調査タスクを抽出しています...',
    });
    try {
      const transcript = liveTextRef.current.slice(-6000);
      const task = await extractTask(transcript, triggerWord);
      pushMessage({ role: 'system', content: `調査タスク：${task}` });
      pushMessage({
        role: 'user',
        content: `次の調査タスクについて、Web検索と過去の文字起こしを参考に調査し、回答してください。\n\n調査タスク：${task}`,
      });
      await requestReply();
    } catch (error: any) {
      pushMessage({
        role: 'system',
        content: `調査に失敗しました: ${error.message || '不明なエラー'}`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Expose runImmediateSolve to parent via solveRef
  useEffect(() => {
    if (solveRef) solveRef.current = () => { void runImmediateSolve(); };
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput('');
    busyRef.current = true;
    setBusy(true);
    pushMessage({ role: 'user', content: text });
    try {
      await requestReply();
    } catch (error: any) {
      pushMessage({
        role: 'system',
        content: `回答の生成に失敗しました: ${error.message || '不明なエラー'}`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleSaveResult = async (msg: ChatMessage) => {
    if (!sessionId || savedIds.has(msg.id)) return;
    try {
      await setDoc(doc(db, 'liveSessions', sessionId), {
        geminiResult: msg.content,
        geminiResultSavedAt: Date.now(),
      }, { merge: true });
      setSavedIds(prev => new Set(prev).add(msg.id));
    } catch (e) {
      console.warn('Failed to save Gemini result:', e);
    }
  };

  const renderMessages = (refEl: React.RefObject<HTMLDivElement | null>) => (
    <div ref={refEl} className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 && !busy && (
        <div className="h-full flex items-center justify-center text-center px-6 py-8">
          <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold leading-relaxed">
            会話中に「{triggerWord}」が検知されると、
            <br />
            Geminiが自動で調査を開始します。
            <br />
            <span className="text-orange-500">「今すぐ解決」</span>で手動実行も可能です。
          </p>
        </div>
      )}

      {messages.map((msg) => {
        if (msg.role === 'system') {
          return (
            <div key={msg.id} className="text-center">
              <span className="inline-block text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full whitespace-pre-wrap text-left">
                {msg.content}
              </span>
            </div>
          );
        }
        const isUser = msg.role === 'user';
        return (
          <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                isUser
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md'
              }`}
              style={{ fontSize: `${fontSize}px` }}
            >
              {msg.content}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    参照元
                  </p>
                  {msg.sources.map((source, i) => (
                    <a
                      key={i}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {source.title || source.uri}
                    </a>
                  ))}
                </div>
              )}
              {/* Save button for assistant replies */}
              {!isUser && sessionId && (
                <div className="mt-2 pt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSaveResult(msg)}
                    disabled={savedIds.has(msg.id)}
                    className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-colors ${
                      savedIds.has(msg.id)
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-500'
                    }`}
                  >
                    {savedIds.has(msg.id) ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                    {savedIds.has(msg.id) ? '保存済み' : '保存'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {busy && (
        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" />
          Geminiが調査中...
        </div>
      )}
    </div>
  );

  const renderHeader = (isPopup: boolean) => (
    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-800/60 shrink-0">
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight flex items-center gap-2 shrink-0">
        <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        <span className="sm:hidden">GeminiAI</span>
        <span className="hidden sm:inline">Gemini Assistant</span>
      </h2>
      {!isPopup && (
        <>
          <span className="hidden sm:inline-block text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 px-2 py-1 rounded-full truncate max-w-[25%]">
            「{triggerWord}」
          </span>
          <span className="hidden sm:inline-block text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-full whitespace-nowrap">
            AI自動検知
          </span>
        </>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={runImmediateSolve}
          disabled={busy}
          title="今すぐ調査を実行"
          className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-lg disabled:opacity-40 transition-colors shrink-0"
        >
          <Play className="w-3 h-3" />
          今すぐ解決
        </button>
        {isPopup ? (
          <>
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setFontSize(s => Math.max(10, s - 2))}
                className="px-2 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-slate-400 w-7 text-center">{fontSize}</span>
              <button
                type="button"
                onClick={() => setFontSize(s => Math.min(24, s + 2))}
                className="px-2 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPopupOpen(false)}
              className="p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setPopupOpen(true)}
            title="別ウィンドウで開く"
            className="p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  const renderInput = () => (
    <form onSubmit={handleSend} className="border-t border-slate-100 dark:border-slate-700 p-3 flex gap-2 bg-slate-50/50 dark:bg-slate-800/60 shrink-0">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Geminiに追加で質問..."
        className="flex-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 duration-150"
      >
        <Send className="w-4 h-4" />
      </button>
    </form>
  );

  return (
    <>
      {/* Inline panel */}
      {popupOpen ? (
        <div
          className="w-full border border-dashed border-violet-300 dark:border-violet-700 rounded-xl min-h-[120px] flex flex-col items-center justify-center gap-2 bg-violet-50/50 dark:bg-violet-900/10 cursor-pointer"
          onClick={() => setPopupOpen(false)}
        >
          <Sparkles className="w-6 h-6 text-violet-400" />
          <p className="text-sm font-semibold text-violet-500 dark:text-violet-400 flex items-center gap-2">
            <Minimize2 className="w-4 h-4" />
            Geminiが別ウィンドウで動作中 — クリックで閉じる
          </p>
        </div>
      ) : (
        <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm flex flex-col overflow-hidden min-h-[420px] lg:min-h-[500px] max-h-[70vh]">
          {renderHeader(false)}
          {renderMessages(scrollRef)}
          {renderInput()}
        </div>
      )}

      {/* Popup overlay */}
      {popupOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPopupOpen(false)}
        >
          <div
            className="w-full max-w-[1152px] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ height: '92vh' }}
            onClick={e => e.stopPropagation()}
          >
            {renderHeader(true)}
            {renderMessages(popupScrollRef)}
            {renderInput()}
          </div>
        </div>
      )}
    </>
  );
}
