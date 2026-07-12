import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  Sparkles, Send, Loader2, ExternalLink, Zap, Maximize2, Minimize2,
  ZoomIn, ZoomOut, X, GripVertical,
} from 'lucide-react';
import { ChatMessage, PastTranscript } from '../types';
import {
  countOccurrences,
  extractTask,
  fetchPastTranscripts,
  sendAssistantChat,
} from '../lib/assistant';

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg_${Date.now()}_${messageSeq}`;
}

interface GeminiAssistantProps {
  liveText: string | null;
  triggerWord: string;
  user: FirebaseUser | null;
  customerNumber?: string;
  sessionId?: string;
}

// Inner chat UI used both inline and in floating window
function GeminiChatUI({
  messages,
  busy,
  input,
  setInput,
  handleSend,
  handleForceResolve,
  scrollRef,
  zoom,
  setZoom,
  isFloating,
  onToggleFloat,
}: {
  messages: ChatMessage[];
  busy: boolean;
  input: string;
  setInput: (v: string) => void;
  handleSend: (e: React.FormEvent) => void;
  handleForceResolve: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  setZoom: (v: number) => void;
  isFloating: boolean;
  onToggleFloat: () => void;
}) {
  return (
    <div
      className="w-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden h-full"
      style={{ fontSize: `${zoom * 100}%` }}
    >
      {/* Header */}
      <div className="p-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50 shrink-0">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-tight flex items-center gap-1.5 flex-1 min-w-0">
          <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
          Gemini Assistant
        </h2>

        {/* 今すぐ解決するボタン */}
        <button
          onClick={handleForceResolve}
          disabled={busy}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm shrink-0"
        >
          <Zap className="w-3.5 h-3.5" />
          今すぐ解決する
        </button>

        {/* ズームコントロール（フローティング時のみ） */}
        {isFloating && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setZoom(Math.max(0.7, zoom - 0.1))}
              className="p-1 rounded hover:bg-slate-200 text-slate-500"
              title="縮小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-bold text-slate-500 w-7 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
              className="p-1 rounded hover:bg-slate-200 text-slate-500"
              title="拡大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ポップアウト/戻すボタン */}
        <button
          onClick={onToggleFloat}
          className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors shrink-0"
          title={isFloating ? 'インラインに戻す' : '別ウインドウで開く'}
        >
          {isFloating ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !busy && (
          <div className="h-full flex items-center justify-center text-center px-6">
            <p className="text-slate-400 text-sm font-semibold leading-relaxed">
              「今すぐ解決する」を押すか、
              <br />
              会話中にトリガーワードが検知されると
              <br />
              Geminiが自動で調査を開始します。
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'system') {
            return (
              <div key={msg.id} className="text-center">
                <span className="inline-block text-[11px] font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full whitespace-pre-wrap text-left">
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
                    : 'bg-slate-100 text-slate-800 rounded-bl-md'
                }`}
              >
                {msg.content}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      参照元
                    </p>
                    {msg.sources.map((source, i) => (
                      <a
                        key={i}
                        href={source.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline break-all"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {source.title || source.uri}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Geminiが調査中...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-slate-100 p-3 flex gap-2 bg-slate-50/50 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Geminiに追加で質問..."
          className="flex-1 border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans bg-white"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

export function GeminiAssistant({ liveText, triggerWord, user, customerNumber, sessionId }: GeminiAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [isFloating, setIsFloating] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [floatPos, setFloatPos] = useState({ x: 40, y: 80 });
  const [floatSize, setFloatSize] = useState({ w: 420, h: 560 });

  const handledCountRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const liveTextRef = useRef('');
  const chatHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const pastTranscriptsRef = useRef<PastTranscript[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag state for floating window
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const geminiResultRef = useRef<string>('');

  const saveGeminiResultToSession = async (result: string) => {
    if (!sessionId) return;
    try {
      await setDoc(doc(db, 'liveSessions', sessionId), { geminiResult: result }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `liveSessions/${sessionId}`);
    }
  };

  const pushMessage = (msg: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...msg, id: nextMessageId() }]);
    if (msg.role !== 'system') {
      chatHistoryRef.current.push({ role: msg.role, content: msg.content });
    }
    if (msg.role === 'assistant') {
      const separator = geminiResultRef.current ? '\n\n---\n\n' : '';
      geminiResultRef.current += separator + msg.content;
      void saveGeminiResultToSession(geminiResultRef.current);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(() => {
    if (liveText === null) return;
    liveTextRef.current = liveText;
    if (!triggerWord) return;

    const count = countOccurrences(liveText, triggerWord);
    if (handledCountRef.current === null) {
      handledCountRef.current = count;
      return;
    }
    if (count > handledCountRef.current) {
      handledCountRef.current = count;
      void runInvestigation();
    }
  }, [liveText, triggerWord]);

  // Reset past transcripts cache when customerNumber changes
  useEffect(() => {
    pastTranscriptsRef.current = null;
  }, [customerNumber]);

  const getPastTranscripts = async (): Promise<PastTranscript[]> => {
    if (pastTranscriptsRef.current) return pastTranscriptsRef.current;
    const past = user ? await fetchPastTranscripts(user.uid, 5, customerNumber) : [];
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
        content: '調査実行中のためスキップしました。完了後に再試行してください。',
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    pushMessage({
      role: 'system',
      content: '文字起こし内容からタスクを抽出しています...',
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

  const handleForceResolve = () => {
    void runInvestigation();
  };

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

  // Drag handlers for floating window
  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.x, origY: floatPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setFloatPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [floatPos]);

  const chatUIProps = {
    messages,
    busy,
    input,
    setInput,
    handleSend,
    handleForceResolve,
    scrollRef,
    zoom,
    setZoom,
    isFloating,
    onToggleFloat: () => setIsFloating(!isFloating),
  };

  if (isFloating) {
    return (
      <>
        {/* Placeholder in original position */}
        <div className="w-full bg-white border-2 border-dashed border-violet-200 rounded-xl flex items-center justify-center min-h-[50vh] text-slate-400 text-sm font-semibold">
          <div className="text-center">
            <Sparkles className="w-8 h-8 text-violet-300 mx-auto mb-2" />
            <p>Gemini Assistantは別ウインドウで表示中</p>
            <button
              onClick={() => setIsFloating(false)}
              className="mt-3 text-xs text-violet-600 hover:underline"
            >
              ここに戻す
            </button>
          </div>
        </div>

        {/* Floating window */}
        <div
          className="fixed z-50 shadow-2xl rounded-xl overflow-hidden flex flex-col"
          style={{
            left: floatPos.x,
            top: floatPos.y,
            width: floatSize.w,
            height: floatSize.h,
            minWidth: 320,
            minHeight: 400,
          }}
        >
          {/* Drag handle */}
          <div
            className="bg-violet-600 text-white px-3 py-2 flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <GripVertical className="w-4 h-4 shrink-0 opacity-70" />
            <span className="text-xs font-bold flex-1">Gemini Assistant</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom(Math.max(0.7, zoom - 0.1))}
                className="p-1 rounded hover:bg-violet-500"
                title="縮小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-bold w-7 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
                className="p-1 rounded hover:bg-violet-500"
                title="拡大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={() => setIsFloating(false)}
              className="p-1 rounded hover:bg-violet-500 ml-1"
              title="閉じる"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Chat UI fills rest */}
          <div className="flex-1 overflow-hidden" style={{ fontSize: `${zoom * 100}%` }}>
            <GeminiChatUI {...chatUIProps} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="w-full flex flex-col flex-1 min-h-[50vh] max-h-[70vh]">
      <GeminiChatUI {...chatUIProps} />
    </div>
  );
}
