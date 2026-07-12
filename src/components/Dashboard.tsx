import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { Recording } from '../types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Cloud, RefreshCw, CheckCircle2, Search, ChevronDown, ChevronUp,
  ChevronsUpDown, FileAudio, Sparkles, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';

const PAGE_SIZE = 30;

type SortField = 'createdAt' | 'customerName' | 'title' | 'summary';
type SortDir = 'asc' | 'desc';

export function Dashboard({ onViewChange, user }: { onViewChange: (view: ViewState) => void; user: FirebaseUser | null }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Search/Filter
  const [tempFreeWord, setTempFreeWord] = useState('');
  const [tempCustomerNo, setTempCustomerNo] = useState('');
  const [tempCustomerName, setTempCustomerName] = useState('');
  const [tempSearchDate, setTempSearchDate] = useState<string | null>(null);
  const [appliedFreeWord, setAppliedFreeWord] = useState('');
  const [appliedCustomerNo, setAppliedCustomerNo] = useState('');
  const [appliedCustomerName, setAppliedCustomerName] = useState('');
  const [appliedSearchDate, setAppliedSearchDate] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [page, setPage] = useState(1);

  // Calendar
  const [calMonth, setCalMonth] = useState<Date>(new Date());

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'recordings'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Recording[];
      data.sort((a, b) => b.createdAt - a.createdAt);
      setRecordings(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'recordings');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [appliedFreeWord, appliedCustomerNo, appliedCustomerName, appliedSearchDate, sortField, sortDir]);

  const getLocalDateString = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const datesWithData = new Set(recordings.map(r => getLocalDateString(r.createdAt)));

  const getDaysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).getDay();

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const daysInMonth = getDaysInMonth(calMonth);
  const firstDayIndex = getFirstDayOfMonth(calMonth);
  const daysArray: (Date | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) daysArray.push(null);
  for (let d = 1; d <= daysInMonth; d++) daysArray.push(new Date(year, month, d));

  const handleSearch = () => {
    setAppliedFreeWord(tempFreeWord);
    setAppliedCustomerNo(tempCustomerNo);
    setAppliedCustomerName(tempCustomerName);
    setAppliedSearchDate(tempSearchDate);
  };

  const handleClearAll = () => {
    setTempFreeWord(''); setTempCustomerNo(''); setTempCustomerName(''); setTempSearchDate(null);
    setAppliedFreeWord(''); setAppliedCustomerNo(''); setAppliedCustomerName(''); setAppliedSearchDate(null);
  };

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const displayTitle = (rec: Recording) => {
    if (rec.customerName) return `${rec.customerNumber || '番号なし'}-${rec.customerName}`;
    let t = rec.title || '面談記録';
    t = t.replace(/^記録:\s*/, '').replace(/様\s*\(.*?\)/g, '').replace(/\(.*?\)/g, '').replace(/様/g, '');
    return t.trim();
  };

  // Filter
  const filteredRecordings = recordings.filter(rec => {
    if (appliedFreeWord.trim()) {
      const kw = appliedFreeWord.toLowerCase();
      if (![rec.title, rec.text, rec.summary, rec.geminiResult].some(f => f?.toLowerCase().includes(kw))) return false;
    }
    if (appliedCustomerNo.trim() && !rec.customerNumber?.toLowerCase().includes(appliedCustomerNo.toLowerCase())) return false;
    if (appliedCustomerName.trim() && !rec.customerName?.toLowerCase().includes(appliedCustomerName.toLowerCase())) return false;
    if (appliedSearchDate && getLocalDateString(rec.createdAt) !== appliedSearchDate) return false;
    return true;
  });

  // Sort
  const sortedRecordings = [...filteredRecordings].sort((a, b) => {
    let va: string | number = '';
    let vb: string | number = '';
    if (sortField === 'createdAt') { va = a.createdAt; vb = b.createdAt; }
    else if (sortField === 'customerName') { va = a.customerName || ''; vb = b.customerName || ''; }
    else if (sortField === 'title') { va = displayTitle(a); vb = displayTitle(b); }
    else if (sortField === 'summary') { va = a.summary || ''; vb = b.summary || ''; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalCount = sortedRecordings.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, totalCount);
  const pageRecords = sortedRecordings.slice(pageStart, pageEnd);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 text-slate-300 ml-1 inline-block" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-600 ml-1 inline-block" />
      : <ChevronDown className="w-3 h-3 text-blue-600 ml-1 inline-block" />;
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Sticky header */}
      <div className="sticky top-0 bg-slate-50 z-20 -mx-4 -mt-4 px-4 py-4 md:-mx-8 md:-mt-8 md:px-8 border-b border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">My面談記録</h2>
          {totalCount > 0 && (
            <span className="text-xs text-slate-500 font-semibold">
              {totalCount}件中 {pageStart + 1}〜{pageEnd}件表示
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 shadow-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { label: 'フリーワード検索', val: tempFreeWord, set: setTempFreeWord, ph: 'キーワード、要約内容...' },
              { label: '整理番号検索', val: tempCustomerNo, set: setTempCustomerNo, ph: '整理番号...' },
              { label: '顧客名検索', val: tempCustomerName, set: setTempCustomerName, ph: '顧客名...' },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</label>
                <input
                  type="text" value={val} onChange={e => set(e.target.value)}
                  placeholder={ph}
                  className="w-full border border-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500 text-xs font-sans"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-3 border-t border-slate-100">
            <div className="md:col-span-8 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">日付検索 (記録あり: 青枠)</span>
                {tempSearchDate && (
                  <button onClick={() => setTempSearchDate(null)} className="text-[10px] text-red-500 hover:underline font-bold">
                    選択解除 ({tempSearchDate})
                  </button>
                )}
              </div>
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50/50 max-w-sm">
                <div className="flex items-center justify-between mb-2 px-1">
                  <button onClick={() => setCalMonth(new Date(year, month - 1, 1))} className="text-slate-500 hover:text-slate-800 text-xs font-bold p-1 hover:bg-slate-200 rounded">&lt;</button>
                  <span className="text-xs font-bold text-slate-700">{format(calMonth, 'yyyy年MM月', { locale: ja })}</span>
                  <button onClick={() => setCalMonth(new Date(year, month + 1, 1))} className="text-slate-500 hover:text-slate-800 text-xs font-bold p-1 hover:bg-slate-200 rounded">&gt;</button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-slate-400 mb-1">
                  {['日', '月', '火', '水', '木', '金', '土'].map(d => <div key={d}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {daysArray.map((day, idx) => {
                    if (!day) return <div key={`e${idx}`} />;
                    const dateStr = getLocalDateString(day.getTime());
                    const hasData = datesWithData.has(dateStr);
                    const isSelected = tempSearchDate === dateStr;
                    return (
                      <button
                        key={dateStr}
                        onClick={() => setTempSearchDate(isSelected ? null : dateStr)}
                        className={`text-xs py-1 rounded-md transition-colors cursor-pointer font-bold select-none ${
                          isSelected ? 'bg-blue-600 text-white' :
                          hasData ? 'bg-blue-100/90 text-blue-800 hover:bg-blue-200 border border-blue-400' :
                          'text-slate-600 hover:bg-slate-200 font-medium'
                        }`}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="md:col-span-4 flex flex-col justify-end space-y-2">
              <button onClick={handleSearch} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5">
                <Search className="w-3.5 h-3.5" />検索開始
              </button>
              <button onClick={handleClearAll} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold">
                フィルターをリセット
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      ) : sortedRecordings.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center border border-slate-200 border-dashed">
          <Cloud className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-semibold">該当する記録が見つかりません</p>
          <p className="text-xs text-slate-400 mt-1">検索条件を変更するか、録音を行ってください</p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th
                      onClick={() => handleSortClick('createdAt')}
                      className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer hover:text-slate-800 whitespace-nowrap select-none w-36"
                    >
                      日時<SortIcon field="createdAt" />
                    </th>
                    <th
                      onClick={() => handleSortClick('customerName')}
                      className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer hover:text-slate-800 whitespace-nowrap select-none w-40"
                    >
                      顧客名<SortIcon field="customerName" />
                    </th>
                    <th
                      onClick={() => handleSortClick('title')}
                      className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer hover:text-slate-800 select-none"
                    >
                      議題<SortIcon field="title" />
                    </th>
                    <th
                      onClick={() => handleSortClick('summary')}
                      className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer hover:text-slate-800 select-none hidden md:table-cell"
                    >
                      AI要約の概要<SortIcon field="summary" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRecords.map(rec => (
                    <>
                      <tr
                        key={rec.id}
                        onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap font-mono">
                          {format(rec.createdAt, 'yy/MM/dd HH:mm', { locale: ja })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-semibold text-slate-800 truncate max-w-[140px]">
                            {rec.customerName || <span className="text-slate-400 italic">—</span>}
                          </div>
                          {rec.customerNumber && (
                            <div className="text-[10px] text-slate-400 font-mono">{rec.customerNumber}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-700 truncate max-w-[180px] font-semibold">
                            {displayTitle(rec)}
                          </div>
                          {rec.participants && rec.participants.length > 0 && (
                            <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                              {rec.participants.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="text-xs text-slate-500 line-clamp-2 max-w-xs">
                            {rec.summary
                              ? rec.summary.replace(/【.*?】/g, '').trim().slice(0, 80)
                              : <span className="italic text-slate-300">—</span>
                            }
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === rec.id && (
                        <tr key={`${rec.id}-detail`} className="bg-blue-50/30">
                          <td colSpan={4} className="px-4 py-5">
                            <div className="space-y-4 max-w-4xl">
                              {/* Header info */}
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <h3 className="font-bold text-sm text-slate-900">{displayTitle(rec)}</h3>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {format(rec.createdAt, 'yyyy年MM月dd日 HH:mm', { locale: ja })}
                                    {rec.participants && rec.participants.length > 0 && (
                                      <span className="ml-3">参加者: {rec.participants.join(', ')}</span>
                                    )}
                                  </p>
                                </div>
                              </div>

                              {/* 文字起こし */}
                              <div className="bg-white rounded-lg border border-slate-200 p-3.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">文字起こしテキスト</div>
                                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 font-sans leading-relaxed">
                                  {rec.text || <span className="text-slate-400 italic">文字起こしデータはありません</span>}
                                </div>
                              </div>

                              {/* AI要約・セカンドアクション */}
                              {rec.summary && (
                                <div className="bg-blue-50/50 rounded-lg border border-blue-100 p-4">
                                  <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                                    AI要約 ＆ セカンドアクション
                                  </div>
                                  <div className="whitespace-pre-wrap text-xs text-slate-700 font-sans leading-relaxed">
                                    {rec.summary}
                                  </div>
                                </div>
                              )}

                              {/* Gemini生成結果 */}
                              {rec.geminiResult && (
                                <div className="bg-violet-50/50 rounded-lg border border-violet-100 p-4">
                                  <div className="text-[10px] font-bold text-violet-800 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                                    Gemini Assistant 生成結果
                                  </div>
                                  <div className="whitespace-pre-wrap text-xs text-slate-700 font-sans leading-relaxed">
                                    {rec.geminiResult}
                                  </div>
                                </div>
                              )}

                              {/* 音声ファイル */}
                              {rec.audioUrl && (
                                <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-2">
                                  <FileAudio className="w-4 h-4 text-slate-400 shrink-0" />
                                  <a
                                    href={rec.audioUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs text-blue-600 hover:underline font-semibold truncate"
                                  >
                                    {rec.audioUrl.split('/').pop() || '音声ファイル'}
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
              <span className="text-xs text-slate-500 font-semibold">
                {totalPages}ページ中 {safePage}ページ目
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let start = Math.max(1, safePage - 2);
                  let end = Math.min(totalPages, start + 4);
                  start = Math.max(1, end - 4);
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                        p === safePage ? 'bg-blue-600 text-white' : 'border border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <span className="text-xs text-slate-500 font-semibold">
                {totalCount}件中 {pageStart + 1}〜{pageEnd}件
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
