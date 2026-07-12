import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, RefreshCw, Loader2, X, Maximize2, ExternalLink } from 'lucide-react';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { STORAGE_KEY, DOC_ID_KEY, loadMessages, saveMessages } from './BetaFeedback';
import type { BetaFeedbackMessage } from '../types';

const QUICK_REPLIES = [
  { label: 'OK', text: 'OK' },
  { label: 'もっと補足を続ける', text: 'もっと補足を続ける' },
  { label: '保存して別のフィードバックを続ける', text: '保存して別のフィードバックを続ける', newDoc: true },
];

interface Props {
  userEmail: string;
  userName: string;
  onClose: () => void;
  onFullScreen: () => void;
}

export function FeedbackChatPopup({ userEmail, userName, onClose, onFullScreen }: Props) {
  const [messages, setMessages] = useState<BetaFeedbackMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{ title: string; description: string } | null>(null);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherInput, setOtherInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const docIdRef = useRef<string | null>(localStorage.getItem(DOC_ID_KEY));

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

  const openNewTab = () => {
    window.open(window.location.origin + '#feedback', '_blank');
  };

  return (
    <div
      className="fixed z-40 flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden
        bottom-20 right-2 left-2
        md:bottom-8 md:right-6 md:left-auto md:w-[min(40rem,50vw)]"
      style={{
        height: 'min(47rem, calc(100dvh - 7rem))',
      }}
    >

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white shrink-0">
        <MessageCircle className="w-4 h-4 shrink-0" />
        <span className="font-bold text-sm flex-1">フィードバック</span>
        <button onClick={resetChat} title="リセット" className="p-1 rounded hover:bg-blue-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button onClick={openNewTab} title="新しいタブで開く" className="p-1 rounded hover:bg-blue-700 transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <button onClick={onFullScreen} title="全画面で開く" className="p-1 rounded hover:bg-blue-700 transition-colors">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} title="閉じる" className="p-1 rounded hover:bg-blue-700 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 dark:text-slate-500 px-4">
            <MessageCircle className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm font-bold mb-1">フィードバックを送信</p>
            <p className="text-xs leading-relaxed">アプリの改善点や気になる点を教えてください。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-sm'
            }`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            </div>
          </div>
        )}

        {/* Quick reply buttons */}
        {pendingSaveData && !sending && (
          <div className="flex flex-col gap-2 mt-2">
            {QUICK_REPLIES.map(({ label, text, newDoc }) => (
              <button
                key={label}
                onClick={() => sendMessage(text, !!newDoc)}
                className="text-left px-3 py-2 rounded-xl border-2 border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors active:scale-95"
              >
                {label}
              </button>
            ))}
            {!showOtherInput ? (
              <button
                onClick={() => setShowOtherInput(true)}
                className="text-left px-3 py-2 rounded-xl border-2 border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors active:scale-95"
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
                  placeholder="内容を入力..."
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

      {/* Input */}
      <div className="border-t border-slate-200 dark:border-slate-700 p-2.5 flex gap-2 shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="改善点・提案を入力..."
          className="flex-1 resize-none md:resize-y rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          style={{ fontSize: '14px', minHeight: '40px', maxHeight: '120px' }}
          rows={1}
          disabled={sending}
        />
        <button
          onClick={() => sendMessage(input.trim())}
          disabled={!input.trim() || sending}
          className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-xl transition-colors active:scale-95"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
