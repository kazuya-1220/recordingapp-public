import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { User as FirebaseUser } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { Radio, ArrowUp } from 'lucide-react';
import { GeminiAssistant } from './GeminiAssistant';
import { getAssistantSettings } from '../lib/assistant';

export function LiveView({
  onViewChange,
  user,
}: {
  onViewChange: (view: ViewState) => void;
  user: FirebaseUser | null;
}) {
  const [sessionId, setSessionId] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [liveText, setLiveText] = useState<string | null>(null);
  const [triggerWord] = useState(() => getAssistantSettings().triggerWord);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isJoined || !sessionId) return;

    const unsubscribe = onSnapshot(doc(db, 'liveSessions', sessionId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setLiveText(data.text || '');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `liveSessions/${sessionId}`);
    });

    return () => unsubscribe();
  }, [isJoined, sessionId]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [liveText]);

  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollTop(el.scrollTop > 200 || distFromBottom > 100);
  };

  const scrollToTop = () => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (sessionId.trim()) {
      setIsJoined(true);
      setLiveText(null);
    }
  };

  return (
    <div className="flex flex-col items-center mt-4">
      {!isJoined ? (
        <div className="w-full max-w-3xl bg-white p-8 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <Radio className="w-8 h-8 text-blue-600" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-center mb-2 tracking-tight text-slate-900">Live Monitor Sync</h2>
          <p className="text-center text-slate-500 mb-8 text-xs font-semibold">録音デバイスに表示された4桁のIDを入力してください</p>

          <form onSubmit={handleJoin} className="space-y-4">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="0000"
              maxLength={4}
              className="w-full text-center text-4xl tracking-[1em] font-mono p-4 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              required
            />
            <input
              type="text"
              value={customerNumber}
              onChange={(e) => setCustomerNumber(e.target.value)}
              placeholder="顧問先番号（任意）"
              className="w-full text-center text-sm font-mono p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-slate-600"
            />
            {customerNumber && (
              <p className="text-xs text-center text-slate-400">
                顧問先番号 <span className="font-bold text-slate-600">{customerNumber}</span> の過去の面談記録を参考にAIが回答します
              </p>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-md hover:bg-blue-700 transition-colors shadow-sm"
            >
              ストリームに接続
            </button>
          </form>
        </div>
      ) : (
        <div className="w-full flex-1 flex flex-col pb-20">
          {/* セッション情報バー */}
          <div className="flex items-center justify-between mb-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1">Session ID</p>
                <p className="text-xl font-mono font-bold text-slate-900">{sessionId}</p>
              </div>
              {customerNumber && (
                <div className="border-l border-slate-200 pl-4">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1">顧問先番号</p>
                  <p className="text-sm font-mono font-bold text-slate-700">{customerNumber}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-2 bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[10px] font-bold text-red-700 tracking-widest uppercase">LIVE</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 items-stretch">
            {/* 左：文字起こしフィード */}
            <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 min-h-[50vh] max-h-[70vh] overflow-hidden">
              <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-tight">文字起こし</h2>
                {showScrollTop && (
                  <button
                    onClick={scrollToTop}
                    className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-full transition-colors"
                    title="先頭に戻る"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    TOP
                  </button>
                )}
              </div>
              <div
                ref={feedRef}
                onScroll={handleFeedScroll}
                className="bg-white px-6 py-8 flex-1 overflow-y-auto text-slate-700 leading-relaxed font-sans text-lg break-words whitespace-pre-wrap"
              >
                {liveText === null ? (
                  <span className="text-slate-400 text-sm font-semibold italic flex items-center justify-center h-full">音声ストリームを待機中...</span>
                ) : liveText || (
                  <span className="text-slate-400 text-sm font-semibold italic flex items-center justify-center h-full">まだ文字起こしがありません。</span>
                )}
              </div>
            </div>

            {/* 右：Geminiアシスタントチャット */}
            <GeminiAssistant
              liveText={liveText}
              triggerWord={triggerWord}
              user={user}
              customerNumber={customerNumber || undefined}
              sessionId={sessionId}
            />
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsJoined(false)}
              className="text-xs uppercase tracking-widest font-bold text-slate-500 hover:text-slate-900 transition-colors"
            >
              切断する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
