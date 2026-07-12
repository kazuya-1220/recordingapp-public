import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, MessageCircle, RefreshCw, Loader2, Minimize2 } from 'lucide-react';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ViewState } from '../App';
import type { BetaFeedbackMessage } from '../types';

export const STORAGE_KEY = 'betaFeedback_messages';
export const DOC_ID_KEY = 'betaFeedback_docId';

export function loadMessages(): BetaFeedbackMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveMessages(msgs: BetaFeedbackMessage[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs)); } catch {}
}

const QUICK_REPLIES = [
  { label: 'OK', text: 'OK' },
  { label: 'もっと補足を続ける', text: 'もっと補足を続ける' },
  { label: '保存して別のフィードバックを続ける', text: '保存して別のフィードバックを続ける', newDoc: true },
];

export function BetaFeedback({ onViewChange, userEmail, userName, onPopupMode, isActive }: {
  onViewChange: (v: ViewState) => void;
  userEmail: string;
  userName: string;
  onPopupMode?: () => void;
  isActive?: boolean;
}) {
  const [messages, setMessages] = useState<BetaFeedbackMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{ title: string; description: string } | null>(null);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherInput, setOtherInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const docIdRef = useRef<string | null>(localStorage.getItem(DOC_ID_KEY));

  // Sync from localStorage when this view becomes active (always-mounted component)
  useEffect(() => {
    if (isActive) {
      const fresh = loadMessages();
      setMessages(fresh);
      docIdRef.current = localStorage.getItem(DOC_ID_KEY);
    }
  }, [isActive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const persistMessages = (msgs: BetaFeedbackMessage[]) => {
    setMessages(msgs);
    saveMessages(msgs);
  };

  const upsertReview = async (conv: BetaFeedbackMessage[], title?: string, description?: string) => {
    try {
      if (docIdRef.current) {
        await updateDoc(doc(db, 'betaReviews', docIdRef.current), {
          conversation: conv.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          updatedAt: Date.now(),
        });
      } else {
        const ref = await addDoc(collection(db, 'betaReviews'), {
          userEmail: userEmail || '匿名',
          userName: userName || '匿名',
          title: title || '（会話中）',
          description: description || '',
          conversation: conv.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
          status: 'open',
          priority: 'medium',
          adminNotes: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        docIdRef.current = ref.id;
        localStorage.setItem(DOC_ID_KEY, ref.id);
      }
    } catch (err) {
      console.error('Failed to upsert review:', err);
    }
  };

  const sendMessage = async (text: string, resetDocAfter = false) => {
    if (!text || sending) return;
    setPendingSaveData(null);
    setShowOtherInput(false);

    const userMsg: BetaFeedbackMessage = { role: 'user', content: text, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    persistMessages(updated);
    setInput('');
    setSending(true);

    await upsertReview(updated);

    try {
      const res = await fetch('/api/beta/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          userEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const aiMsg: BetaFeedbackMessage = { role: 'assistant', content: data.reply, timestamp: Date.now() };
      const withAi = [...updated, aiMsg];
      persistMessages(withAi);
      await upsertReview(withAi, data.saveData?.title, data.saveData?.description);

      if (data.saveData) {
        setPendingSaveData(data.saveData);
      }
      if (resetDocAfter) {
        docIdRef.current = null;
        localStorage.removeItem(DOC_ID_KEY);
      }
    } catch {
      persistMessages([...updated, {
        role: 'assistant',
        content: 'エラーが発生しました。もう一度お試しください。',
        timestamp: Date.now(),
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.trim());
    }
  };

  const resetChat = () => {
    persistMessages([]);
    docIdRef.current = null;
    localStorage.removeItem(DOC_ID_KEY);
    setInput('');
    setPendingSaveData(null);
    setShowOtherInput(false);
  };

  return (
    <div className="mt-4 flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => onViewChange('settings')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-95">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <MessageCircle className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">フィードバック</h2>
        <div className="ml-auto flex items-center gap-2">
          {onPopupMode && (
            <button
              onClick={onPopupMode}
              title="ポップアップに戻す"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-95 text-slate-400 hover:text-slate-600"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={resetChat}
            title="会話をリセット"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-bold text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            会話をリセット
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 dark:text-slate-500 px-6">
              <MessageCircle className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm font-bold mb-1">フィードバックを送信</p>
              <p className="text-xs leading-relaxed">
                アプリの改善点や気になる点を教えてください。<br />
                AIがヒアリングし、具体的なフィードバックとして記録します。
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-md'
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-md px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            </div>
          )}

          {/* Quick reply buttons when AI proposes saving */}
          {pendingSaveData && !sending && (
            <div className="flex flex-col gap-2 mt-2">
              {QUICK_REPLIES.map(({ label, text, newDoc }) => (
                <button
                  key={label}
                  onClick={() => sendMessage(text, !!newDoc)}
                  className="text-left px-4 py-2.5 rounded-xl border-2 border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors active:scale-95"
                >
                  {label}
                </button>
              ))}
              {!showOtherInput ? (
                <button
                  onClick={() => setShowOtherInput(true)}
                  className="text-left px-4 py-2.5 rounded-xl border-2 border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors active:scale-95"
                >
                  その他
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otherInput}
                    onChange={e => setOtherInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && otherInput.trim()) { sendMessage(otherInput.trim()); setOtherInput(''); } }}
                    placeholder="内容を入力してください..."
                    autoFocus
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
                  />
                  <button
                    onClick={() => { if (otherInput.trim()) { sendMessage(otherInput.trim()); setOtherInput(''); } }}
                    disabled={!otherInput.trim()}
                    className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="気になる点や改善の提案を入力..."
              className="flex-1 resize-none md:resize-y rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
              style={{ fontSize: '16px', minHeight: '44px', maxHeight: '160px' }}
              rows={1}
              disabled={sending}
            />
            <button
              onClick={() => sendMessage(input.trim())}
              disabled={!input.trim() || sending}
              className="p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-xl transition-colors active:scale-95"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
