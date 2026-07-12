import { useState, useEffect } from 'react';
import { ArrowLeft, ClipboardList, ChevronDown, MessageCircle, Clock, CheckCircle2, XCircle, Rocket, Package } from 'lucide-react';
import { collection, onSnapshot, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ViewState } from '../App';
import type { BetaReview, ReviewStatus } from '../types';

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string; Icon: typeof Clock }> = {
  open: { label: '未対応', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', Icon: Clock },
  under_review: { label: 'レビュー中', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', Icon: ClipboardList },
  accepted: { label: '採択', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', Icon: CheckCircle2 },
  rejected: { label: '却下', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', Icon: XCircle },
  in_progress: { label: '実装中', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', Icon: Rocket },
  released: { label: 'リリース済', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', Icon: Package },
};

const ALL_STATUSES: ReviewStatus[] = ['open', 'under_review', 'accepted', 'rejected', 'in_progress', 'released'];

function StatusBadge({ status }: { status: ReviewStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function ReviewDashboard({ onViewChange, isAdmin }: {
  onViewChange: (v: ViewState) => void;
  isAdmin: boolean;
}) {
  const [reviews, setReviews] = useState<BetaReview[]>([]);
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'betaReviews'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() } as BetaReview)));
    });
    return unsub;
  }, []);

  const filtered = filter === 'all' ? reviews : reviews.filter(r => r.status === filter);

  const updateStatus = async (id: string, status: ReviewStatus) => {
    await updateDoc(doc(db, 'betaReviews', id), { status, updatedAt: Date.now() });
  };

  const saveNotes = async (id: string) => {
    await updateDoc(doc(db, 'betaReviews', id), { adminNotes: notesText, updatedAt: Date.now() });
    setEditingNotes(null);
  };

  const counts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = reviews.filter(r => r.status === s).length;
    return acc;
  }, {} as Record<ReviewStatus, number>);

  return (
    <div className="mt-4 space-y-4 pb-36">
      <div className="flex items-center gap-3">
        <button onClick={() => onViewChange('settings')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-95">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <ClipboardList className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">レビュー管理</h2>
        <span className="text-sm text-slate-400 font-bold">{reviews.length}件</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {ALL_STATUSES.map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
              className={`flex flex-col items-center py-2 px-1 rounded-xl border-2 transition-all active:scale-95 ${
                filter === s ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100">{counts[s]}</span>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{cfg.label}</span>
            </button>
          );
        })}
      </div>

      {/* Review list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">
            <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-bold">レビューがありません</p>
          </div>
        )}
        {filtered.map(r => {
          const expanded = expandedId === r.id;
          return (
            <div key={r.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : r.id)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={r.status} />
                    {r.priority && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        r.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        r.priority === 'low' ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {r.priority === 'high' ? '高' : r.priority === 'low' ? '低' : '中'}
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{r.title}</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {r.userName} · {new Date(r.createdAt).toLocaleDateString('ja-JP')}
                  </p>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>

              {expanded && (
                <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">詳細</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{r.description}</p>
                  </div>

                  {r.conversation && r.conversation.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        会話履歴
                      </h4>
                      <div className="space-y-2 max-h-60 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                        {r.conversation.map((m, i) => (
                          <div key={i} className={`text-xs ${m.role === 'user' ? 'text-blue-700 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                            <span className="font-bold">{m.role === 'user' ? 'ユーザー' : 'AI'}：</span>
                            {m.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {r.aiAnalysis && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">AI分析</h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 rounded-lg p-3">{r.aiAnalysis}</p>
                    </div>
                  )}

                  {isAdmin && (
                    <>
                      <div>
                        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">ステータス変更</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_STATUSES.map(s => (
                            <button
                              key={s}
                              onClick={() => updateStatus(r.id, s)}
                              disabled={r.status === s}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                                r.status === s
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                              }`}
                            >
                              {STATUS_CONFIG[s].label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">管理者メモ</h4>
                        {editingNotes === r.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={notesText}
                              onChange={e => setNotesText(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
                              rows={3}
                              style={{ fontSize: '16px' }}
                            />
                            <div className="flex gap-2">
                              <button onClick={() => saveNotes(r.id)} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg active:scale-95">保存</button>
                              <button onClick={() => setEditingNotes(null)} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg active:scale-95">キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingNotes(r.id); setNotesText(r.adminNotes || ''); }}
                            className="w-full text-left text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg p-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            {r.adminNotes || 'メモを追加...'}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
