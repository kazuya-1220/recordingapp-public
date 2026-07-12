import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, onSnapshot, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { TimedLine } from '../types';
import { Radio, Search, Users, X, Loader2, LogOut, Check, ChevronDown, UserPlus, Paperclip, Trash2, Pencil, Wand2, Download, Maximize2 } from 'lucide-react';
import { AttachmentPreviewModal, downloadAttachment, openAttachmentInPlace } from './AttachmentPreviewModal';
import { getKintoneSettings } from '../lib/kintone';
import { TAX_BRAIN_MEMBERS, memberMatchesQuery, getNameByEmail } from '../lib/members';
import { ScrollToTop } from './ScrollToTop';
import { GeminiAssistant } from './GeminiAssistant';
import { getAssistantSettings } from '../lib/assistant';

export function LiveView({ onViewChange, isActive = true }: { onViewChange: (view: ViewState) => void; isActive?: boolean }) {
  const [sessionId, setSessionId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [timedLines, setTimedLines] = useState<TimedLine[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [feedTab, setFeedTab] = useState<'tl' | 'raw'>('tl');
  const [triggerWord] = useState(() => getAssistantSettings().triggerWord);
  const geminiSolveRef = React.useRef<(() => void) | null>(null);
  const [transcriptFullscreen, setTranscriptFullscreen] = useState(false);

  // Kintone lookup
  const [kintoneConfig, setKintoneConfig] = useState<any>(null);
  const [customerKeyword, setCustomerKeyword] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Participants
  const [participantInput, setParticipantInput] = useState('');
  const [participantsList, setParticipantsList] = useState<string[]>([]);
  const [showMemberList, setShowMemberList] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const memberListRef = useRef<HTMLDivElement>(null);

  type FSAttachment = { url: string; name: string; ocrText: string | null };
  interface UploadItem { id: string; name: string; loading: boolean; error?: string }

  const [liveUploadItems, setLiveUploadItems] = useState<UploadItem[]>([]);
  const [liveAttachments, setLiveAttachments] = useState<FSAttachment[]>([]);
  const [recorderAttachments, setRecorderAttachments] = useState<FSAttachment[]>([]);
  const [expandedOcr, setExpandedOcr] = useState<Set<string>>(new Set());
  const [editingAttUrl, setEditingAttUrl] = useState<string | null>(null);
  const [editingAttName, setEditingAttName] = useState('');
  const [aiRenamingUrls, setAiRenamingUrls] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const liveAttachmentInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerListRef = useRef<HTMLDivElement>(null);
  const dragCountRef = useRef(0);
  const addLiveFilesRef = useRef<(files: File[]) => void>(() => {});

  useEffect(() => {
    async function loadConfig() {
      const config = await getKintoneSettings();
      setKintoneConfig(config);
    }
    loadConfig();
  }, []);

  useEffect(() => { addLiveFilesRef.current = addLiveFiles; });

  // Browser-wide drag-and-drop (only active when joined AND this view is visible,
  // so a drop doesn't get uploaded by both the Recorder and LiveView at once)
  useEffect(() => {
    if (!isJoined || !isActive) return;
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current++;
      if (dragCountRef.current === 1) setIsDraggingOver(true);
    };
    const onDragLeave = () => {
      dragCountRef.current--;
      if (dragCountRef.current === 0) setIsDraggingOver(false);
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCountRef.current = 0;
      setIsDraggingOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) addLiveFilesRef.current(files);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [isJoined, isActive]);

  // Debounced customer auto-search
  useEffect(() => {
    if (!customerKeyword.trim()) {
      setCustomers([]);
      setLookupError(null);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      searchCustomers(customerKeyword.trim());
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [customerKeyword, kintoneConfig]);

  useEffect(() => {
    if (!showMemberList) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (memberListRef.current && !memberListRef.current.contains(e.target as Node)) {
        setShowMemberList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMemberList]);

  useEffect(() => {
    if (!isJoined || !sessionId) return;
    const unsubscribe = onSnapshot(doc(db, 'liveSessions', sessionId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setLiveText(data.text || '');
        setTimedLines(data.timedLines || []);
        if (data.recorderAttachments && Array.isArray(data.recorderAttachments)) {
          setRecorderAttachments(data.recorderAttachments);
        }
        if (data.liveAttachments && Array.isArray(data.liveAttachments)) {
          setLiveAttachments(data.liveAttachments);
        }
        if (data.participants && Array.isArray(data.participants)) {
          setParticipantsList(data.participants);
        }
        if (data.customerName) {
          setSelectedCustomer({ name: data.customerName, number: data.customerNumber || '', submitNo: data.customerSubmitNo || '' });
        } else if (data.customerName === '') {
          setSelectedCustomer(null);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `liveSessions/${sessionId}`);
    });
    return () => unsubscribe();
  }, [isJoined, sessionId]);

  const syncToFirestore = async (update: any) => {
    if (!sessionId) return;
    setSyncError(null);
    try {
      await setDoc(doc(db, 'liveSessions', sessionId), update, { merge: true });
    } catch (e: any) {
      console.error('Sync error:', e);
      setSyncError(`同期エラー: ${e?.code || e?.message || '不明なエラー'}`);
    }
  };

  const deleteRecorderAttachment = async (att: FSAttachment) => {
    if (!sessionId) return;
    await setDoc(doc(db, 'liveSessions', sessionId), {
      recorderAttachments: arrayRemove(att)
    }, { merge: true });
  };

  const deleteLiveAttachment = async (att: FSAttachment) => {
    if (!sessionId) return;
    await setDoc(doc(db, 'liveSessions', sessionId), {
      liveAttachments: arrayRemove(att)
    }, { merge: true });
  };

  // Rename an attachment by url (rewrites the whole array so it syncs both ways)
  const renameAttachment = (field: 'recorderAttachments' | 'liveAttachments', url: string, newName: string) => {
    setEditingAttUrl(null);
    const trimmed = newName.trim();
    if (!sessionId || !trimmed) return;
    const arr = field === 'recorderAttachments' ? recorderAttachments : liveAttachments;
    const next = arr.map(a => (a.url === url ? { ...a, name: trimmed } : a));
    if (field === 'recorderAttachments') setRecorderAttachments(next); else setLiveAttachments(next);
    setDoc(doc(db, 'liveSessions', sessionId), { [field]: next }, { merge: true })
      .catch(e => console.warn('[Rename att]', e));
  };

  const aiRenameAttachment = async (field: 'recorderAttachments' | 'liveAttachments', att: FSAttachment) => {
    setAiRenamingUrls(prev => new Set(prev).add(att.url));
    try {
      const res = await fetch('/api/rename-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: att.name, ocrText: att.ocrText })
      });
      const data = await res.json();
      if (res.ok && data.suggested) renameAttachment(field, att.url, data.suggested);
    } catch { /* non-fatal */ }
    finally {
      setAiRenamingUrls(prev => { const n = new Set(prev); n.delete(att.url); return n; });
    }
  };

  const handleCustomerInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (customers.length === 1) selectCustomer(customers[0]);
      else if (customers.length > 1) (customerListRef.current?.querySelector('button') as HTMLElement | null)?.focus();
    } else if (e.key === 'ArrowDown' && customers.length > 0) {
      e.preventDefault();
      (customerListRef.current?.querySelector('button') as HTMLElement | null)?.focus();
    }
  };

  const handleCustomerListKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const btns = customerListRef.current?.querySelectorAll('button');
      if (btns && i + 1 < btns.length) (btns[i + 1] as HTMLElement).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) customerInputRef.current?.focus();
      else {
        const btns = customerListRef.current?.querySelectorAll('button');
        if (btns) (btns[i - 1] as HTMLElement).focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCustomers([]);
      customerInputRef.current?.focus();
    }
  };

  const searchCustomers = async (keyword: string) => {
    if (!kintoneConfig?.domain || !kintoneConfig?.customerAppId || !kintoneConfig?.customerApiToken) {
      setLookupError('Kintone設定が未設定です。');
      return;
    }
    setIsSearchingCustomers(true);
    setLookupError(null);
    try {
      const res = await fetch('/api/kintone/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: kintoneConfig.domain,
          customerAppId: kintoneConfig.customerAppId,
          customerApiToken: kintoneConfig.customerApiToken,
          keyword,
          nameField: kintoneConfig.customerNameField || '顧客名',
          numberField: kintoneConfig.customerNumberField || '顧客番号',
          submitField: kintoneConfig.customerSubmitField || 'submit_No'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '検索失敗');
      setCustomers(data.customers || []);
      if (!data.customers?.length) setLookupError('該当する顧客が見つかりませんでした。');
    } catch (err: any) {
      setLookupError(err.message || 'エラーが発生しました。');
    } finally {
      setIsSearchingCustomers(false);
    }
  };

  const selectCustomer = async (c: any) => {
    setSelectedCustomer(c);
    setCustomers([]);
    setCustomerKeyword('');
    await syncToFirestore({ customerName: c.name, customerNumber: c.number || '', customerSubmitNo: c.submitNo || '' });
  };

  const toggleMember = async (name: string) => {
    const newList = participantsList.includes(name)
      ? participantsList.filter(p => p !== name)
      : [...participantsList, name];
    setParticipantsList(newList);
    await syncToFirestore({ participants: newList });
  };

  const addExternalParticipant = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = participantInput.trim();
    if (!name || participantsList.includes(name)) return;
    const newList = [...participantsList, name];
    setParticipantsList(newList);
    setParticipantInput('');
    await syncToFirestore({ participants: newList });
  };

  const removeParticipant = async (name: string) => {
    const newList = participantsList.filter(p => p !== name);
    setParticipantsList(newList);
    await syncToFirestore({ participants: newList });
  };

  const addLiveFiles = async (files: File[]) => {
    const sid = sessionId;
    const newItems: UploadItem[] = files.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
      name: f.name,
      loading: true,
    }));
    setLiveUploadItems(prev => [...prev, ...newItems]);

    await Promise.all(files.map(async (file, i) => {
      const item = newItems[i];
      const fd = new FormData();
      fd.append('files', file, file.name);
      try {
        const res = await fetch('/api/ocr', { method: 'POST', body: fd });
        const data = await res.json();
        const result = data.results?.[0];
        const url: string = result?.url || '';
        const ocrText: string | null = result?.ocrText ?? null;
        setLiveUploadItems(prev => prev.filter(u => u.id !== item.id));
        if (sid && url) {
          await setDoc(doc(db, 'liveSessions', sid), {
            liveAttachments: arrayUnion({ url, name: file.name, ocrText })
          }, { merge: true });
        }
      } catch {
        setLiveUploadItems(prev => prev.map(u =>
          u.id === item.id ? { ...u, loading: false, error: 'アップロードに失敗しました' } : u
        ));
      }
    }));
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const sid = sessionId.trim();
    if (!sid) return;
    setIsJoined(true);
    // Immediately seed state from Firestore so iOS doesn't show empty data
    // while the onSnapshot connection warms up (cold-start latency fix).
    try {
      const snap = await getDoc(doc(db, 'liveSessions', sid));
      if (snap.exists()) {
        const data = snap.data();
        setLiveText(data.text || '待機中...');
        setTimedLines(data.timedLines || []);
        if (data.recorderAttachments?.length) setRecorderAttachments(data.recorderAttachments);
        if (data.liveAttachments?.length) setLiveAttachments(data.liveAttachments);
        if (data.participants?.length) setParticipantsList(data.participants);
        if (data.customerName) {
          setSelectedCustomer({ name: data.customerName, number: data.customerNumber || '', submitNo: data.customerSubmitNo || '' });
        }
      } else {
        setLiveText('待機中...');
      }
    } catch {
      setLiveText('待機中...');
    }
  };

  return (
    <div className="flex flex-col items-center mt-4">
      <ScrollToTop />
      {!isJoined ? (
        <div className="w-full bg-white dark:bg-slate-800 p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex justify-center mb-6">
            <div className="bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-lg">
              <Radio className="w-8 h-8 text-emerald-600" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-center mb-2 tracking-tight text-slate-900 dark:text-slate-100">ライブ同期</h2>
          <p className="text-center text-slate-500 dark:text-slate-400 mb-2 text-sm leading-relaxed">
            録音端末の「録音」画面に表示されている<br />4桁のIDを入力してください
          </p>
          <p className="text-center text-slate-400 mb-8 text-xs">
            ※録音開始後にIDが表示されます。リアルタイムで文字起こしの確認と顧客情報の入力ができます
          </p>
          <form onSubmit={handleJoin} className="space-y-4">
            <input type="text" value={sessionId} onChange={(e) => setSessionId(e.target.value)}
              placeholder="0000" maxLength={4}
              className="w-full text-center text-4xl tracking-[1em] tabular-nums p-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
              required />
            <button type="submit"
              className="w-full bg-emerald-600 text-white font-bold py-4 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm text-base active:scale-95 duration-150">
              同期を開始する
            </button>
          </form>
        </div>
      ) : (
        <div className="w-full flex-1 flex flex-col pb-36 space-y-4">
          {/* Browser-wide drag overlay */}
          {isDraggingOver && (
            <div className="fixed inset-0 z-50 bg-emerald-600/20 border-4 border-emerald-500 border-dashed flex items-center justify-center pointer-events-none">
              <div className="bg-white dark:bg-slate-800 rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3">
                <Paperclip className="w-10 h-10 text-emerald-600" />
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">ここにドロップしてアップロード</p>
                <p className="text-sm text-slate-400">複数ファイルも同時にドロップできます</p>
              </div>
            </div>
          )}
          {/* Sync error banner */}
          {syncError && (
            <div className="w-full bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold px-4 py-3 rounded-xl">
              ⚠️ {syncError}
            </div>
          )}

          {/* Compact status bar */}
          <div className="w-full relative flex items-center justify-start md:justify-center bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-800 py-3 px-4 pr-28 md:pr-4 rounded-xl shadow-sm border border-emerald-100 dark:border-emerald-900/40">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest shrink-0">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                ライブ同期中
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">セッションID</span>
                <span className="text-xl tabular-nums font-bold tracking-[0.15em] text-emerald-600 dark:text-emerald-400">{sessionId}</span>
              </span>
            </div>
            <button
              onClick={() => {
                setIsJoined(false);
                setLiveText('');
                setTimedLines([]);
                setSelectedCustomer(null);
                setParticipantsList([]);
                setCustomerKeyword('');
                setCustomers([]);
                setShowMemberList(false);
                setLiveUploadItems([]);
                setLiveAttachments([]);
                setRecorderAttachments([]);
                setExpandedOcr(new Set());
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-sm font-bold px-4 py-2 bg-red-500 hover:bg-red-600 active:scale-95 text-white rounded-lg transition-colors shadow-sm shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              同期解除
            </button>
          </div>

          {/* Main 2-column: left=controls, right=transcript */}
          <div className="w-full grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-4 items-start">

          {/* LEFT COLUMN: controls */}
          <div className="flex flex-col gap-4">

          {/* Customer Lookup card */}
          <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <Search className="w-4 h-4 text-emerald-600" />
                  kintone顧客DBルックアップ
                </h3>
                {selectedCustomer && (
                  <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-2 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                    <Check className="w-3 h-3" />選択済み
                  </span>
                )}
              </div>

              {selectedCustomer ? (
                <div className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-4 rounded-lg flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">選択された顧客</p>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                      {selectedCustomer.number && (
                        <span className="text-emerald-600 dark:text-emerald-400 mr-2">{selectedCustomer.number}</span>
                      )}
                      {selectedCustomer.name}
                    </p>
                  </div>
                  <button type="button"
                    onClick={() => { setSelectedCustomer(null); syncToFirestore({ customerName: '', customerNumber: '', customerSubmitNo: '' }); }}
                    className="p-1.5 text-slate-400 hover:text-red-500 rounded-full transition-colors active:scale-95 duration-150">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      ref={customerInputRef}
                      type="text"
                      placeholder="顧問先名または顧問先番号を入力して検索..."
                      value={customerKeyword}
                      onChange={(e) => setCustomerKeyword(e.target.value)}
                      onKeyDown={handleCustomerInputKeyDown}
                      className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 pl-3 pr-10 py-3 rounded-lg focus:outline-none focus:border-emerald-500 text-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {isSearchingCustomers
                        ? <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                        : <Search className="w-4 h-4 text-slate-400" />
                      }
                    </div>
                  </div>
                  {lookupError && <p className="text-xs text-red-500 font-medium">{lookupError}</p>}
                  {customers.length > 0 && (
                    <div
                      ref={customerListRef}
                      className="border border-slate-200 dark:border-slate-600 rounded-lg max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 bg-slate-100 dark:bg-slate-950 shadow-lg"
                    >
                      {customers.map((c, i) => (
                        <button
                          key={c.id || c.number || c.name}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          onKeyDown={(e) => handleCustomerListKeyDown(e, i)}
                          className="w-full text-left px-4 py-3 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 transition-colors active:scale-[0.99] duration-150"
                        >
                          <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400 mr-2">{c.number}</span>
                          <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{c.name || '名称未設定'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* Participants card */}
          <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
              {(() => {
                const selfName = getNameByEmail((auth.currentUser?.email || '').toLowerCase()) || auth.currentUser?.displayName;
                const internal = participantsList.filter(p => TAX_BRAIN_MEMBERS.includes(p) || p === selfName);
                const external = participantsList.filter(p => !TAX_BRAIN_MEMBERS.includes(p) && p !== selfName);
                return (
                  <>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <Users className="w-4 h-4 text-emerald-600" />
                      今回の参加者の氏名
                      <span className="ml-auto flex items-center gap-1 shrink-0">
                        <span className="text-xs font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full border border-emerald-100 dark:border-emerald-800 whitespace-nowrap">社内 {internal.length}名</span>
                        <span className="text-xs font-bold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full border border-amber-100 dark:border-amber-800 whitespace-nowrap">社外 {external.length}名</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${participantsList.length > 0 ? 'bg-slate-700 dark:bg-slate-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>計 {participantsList.length}名</span>
                      </span>
                    </h3>

                    <div ref={memberListRef}>
                      <button
                        type="button"
                        onClick={() => { setShowMemberList(!showMemberList); setMemberQuery(''); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors active:scale-[0.99] duration-150"
                      >
                        <span className="font-medium">社内メンバーから選択</span>
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showMemberList ? 'rotate-180' : ''}`} />
                      </button>

                      {showMemberList && (
                        <div className="mt-1 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-blue-50 dark:bg-blue-950">
                          <div className="p-2 border-b border-blue-100 dark:border-blue-900 bg-white dark:bg-slate-900">
                            <div className="relative">
                              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                autoFocus
                                type="text"
                                value={memberQuery}
                                onChange={(e) => setMemberQuery(e.target.value)}
                                placeholder="名前・ふりがなで絞り込み..."
                                style={{ fontSize: '16px' }}
                                className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                          </div>
                          <div className="max-h-52 overflow-y-auto">
                            {TAX_BRAIN_MEMBERS.filter(m => memberMatchesQuery(m, memberQuery)).map((member) => {
                              const selected = participantsList.includes(member);
                              return (
                                <button
                                  key={member}
                                  type="button"
                                  onClick={() => toggleMember(member)}
                                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors border-b border-slate-100 dark:border-slate-700 last:border-b-0 active:scale-[0.99] duration-150 ${selected ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-slate-100' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                                >
                                  <span className="font-medium">{member}</span>
                                  {selected && <Check className="w-4 h-4 text-emerald-600 dark:text-white" />}
                                </button>
                              );
                            })}
                            {TAX_BRAIN_MEMBERS.filter(m => memberMatchesQuery(m, memberQuery)).length === 0 && (
                              <p className="px-4 py-3 text-sm text-slate-400">該当するメンバーがいません</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <form onSubmit={addExternalParticipant} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="社外参加者の氏名を入力..."
                        value={participantInput}
                        onChange={(e) => setParticipantInput(e.target.value)}
                        className="flex-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500 text-sm"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center shrink-0 border border-slate-200 dark:border-slate-600 active:scale-95 duration-150"
                      >
                        <UserPlus className="w-4 h-4 mr-1.5" />追加
                      </button>
                    </form>

                    {/* Internal member tags */}
                    {internal.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {internal.map((p) => (
                          <div
                            key={p}
                            className="flex items-center bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800 rounded-md px-2 py-1 text-[11px] font-semibold"
                          >
                            <span>{p}</span>
                            <button
                              type="button"
                              onClick={() => removeParticipant(p)}
                              className="ml-1.5 p-0.5 hover:opacity-60 transition-opacity rounded-full active:scale-90 duration-150"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* External participant tags */}
                    {external.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {external.map((p) => (
                          <div
                            key={p}
                            className="flex items-center bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-md px-2 py-1 text-[11px] font-semibold"
                          >
                            <span>{p}</span>
                            <button
                              type="button"
                              onClick={() => removeParticipant(p)}
                              className="ml-1.5 p-0.5 hover:opacity-60 transition-opacity rounded-full active:scale-90 duration-150"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
          </div>

          {/* Attachments card */}
          <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-emerald-600" />
                添付資料
                {(recorderAttachments.length + liveAttachments.length + liveUploadItems.length) > 0 && (
                  <span className="ml-auto text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-800">
                    {recorderAttachments.length + liveAttachments.length + liveUploadItems.length}件
                  </span>
                )}
              </h3>

              {/* Recorder's attachments with delete */}
              {recorderAttachments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wider">録音画面から共有</p>
                  {recorderAttachments.map((att, i) => (
                    <div key={i} className="border border-blue-100 dark:border-blue-900 rounded-lg overflow-hidden text-sm">
                      <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
                        <Paperclip className="w-4 h-4 text-blue-400 shrink-0" />
                        {editingAttUrl === att.url ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingAttName}
                            onChange={e => setEditingAttName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') renameAttachment('recorderAttachments', att.url, editingAttName);
                              if (e.key === 'Escape') setEditingAttUrl(null);
                            }}
                            onBlur={() => renameAttachment('recorderAttachments', att.url, editingAttName)}
                            className="flex-1 min-w-0 px-2 py-0.5 text-sm border border-blue-400 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            title="プレビュー"
                            onClick={() => { if (openAttachmentInPlace(att.url, att.name)) setPreview({ url: att.url, name: att.name }); }}
                            className="flex-1 truncate font-medium text-blue-600 dark:text-blue-400 hover:underline text-left"
                          >{att.name}</button>
                        )}
                        {editingAttUrl !== att.url && (
                          <>
                            <button
                              type="button"
                              title="ダウンロード"
                              onClick={() => downloadAttachment(att.url, att.name)}
                              className="p-0.5 text-slate-400 hover:text-blue-500 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              title="ファイル名を編集"
                              onClick={() => { setEditingAttUrl(att.url); setEditingAttName(att.name); }}
                              className="p-0.5 text-slate-400 hover:text-blue-500 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              title="AIでファイル名をリネーム"
                              onClick={() => aiRenameAttachment('recorderAttachments', att)}
                              disabled={aiRenamingUrls.has(att.url)}
                              className="p-0.5 text-slate-400 hover:text-purple-500 disabled:opacity-40 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              {aiRenamingUrls.has(att.url) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                        {att.ocrText && (
                          <button
                            type="button"
                            onClick={() => setExpandedOcr(prev => {
                              const next = new Set(prev);
                              const key = `rec-${i}`;
                              next.has(key) ? next.delete(key) : next.add(key);
                              return next;
                            })}
                            className="text-xs text-blue-600 dark:text-blue-400 font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0 flex items-center gap-0.5"
                          >
                            OCR <ChevronDown className={`w-3 h-3 transition-transform ${expandedOcr.has(`rec-${i}`) ? 'rotate-180' : ''}`} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteRecorderAttachment(att)}
                          className="p-0.5 text-red-400 hover:text-red-600 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {expandedOcr.has(`rec-${i}`) && att.ocrText && (
                        <div className="px-3 py-2 border-t border-blue-50 dark:border-blue-900 max-h-40 overflow-y-auto bg-white dark:bg-slate-800">
                          <pre className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{att.ocrText}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* LiveView uploaded attachments with delete */}
              {liveAttachments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">ライブ同期からUP</p>
                  {liveAttachments.map((att, i) => (
                    <div key={i} className="border border-emerald-200 dark:border-emerald-800 rounded-lg overflow-hidden text-sm">
                      <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20">
                        <Paperclip className="w-4 h-4 text-emerald-500 shrink-0" />
                        {editingAttUrl === att.url ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingAttName}
                            onChange={e => setEditingAttName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') renameAttachment('liveAttachments', att.url, editingAttName);
                              if (e.key === 'Escape') setEditingAttUrl(null);
                            }}
                            onBlur={() => renameAttachment('liveAttachments', att.url, editingAttName)}
                            className="flex-1 min-w-0 px-2 py-0.5 text-sm border border-emerald-400 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            title="プレビュー"
                            onClick={() => { if (openAttachmentInPlace(att.url, att.name)) setPreview({ url: att.url, name: att.name }); }}
                            className="flex-1 truncate font-medium text-emerald-600 dark:text-emerald-400 hover:underline text-left"
                          >{att.name}</button>
                        )}
                        {editingAttUrl !== att.url && (
                          <>
                            <button
                              type="button"
                              title="ダウンロード"
                              onClick={() => downloadAttachment(att.url, att.name)}
                              className="p-0.5 text-slate-400 hover:text-emerald-600 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              title="ファイル名を編集"
                              onClick={() => { setEditingAttUrl(att.url); setEditingAttName(att.name); }}
                              className="p-0.5 text-slate-400 hover:text-emerald-600 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              title="AIでファイル名をリネーム"
                              onClick={() => aiRenameAttachment('liveAttachments', att)}
                              disabled={aiRenamingUrls.has(att.url)}
                              className="p-0.5 text-slate-400 hover:text-purple-500 disabled:opacity-40 transition-colors active:scale-90 duration-150 shrink-0"
                            >
                              {aiRenamingUrls.has(att.url) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                        {att.ocrText && (
                          <button
                            type="button"
                            onClick={() => setExpandedOcr(prev => {
                              const next = new Set(prev);
                              const key = `live-${i}`;
                              next.has(key) ? next.delete(key) : next.add(key);
                              return next;
                            })}
                            className="text-xs text-emerald-600 dark:text-emerald-400 font-bold px-2 py-1 bg-emerald-50 dark:bg-emerald-900/30 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50 shrink-0 flex items-center gap-0.5"
                          >
                            OCR <ChevronDown className={`w-3 h-3 transition-transform ${expandedOcr.has(`live-${i}`) ? 'rotate-180' : ''}`} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteLiveAttachment(att)}
                          className="p-0.5 text-red-400 hover:text-red-600 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {expandedOcr.has(`live-${i}`) && att.ocrText && (
                        <div className="px-3 py-2 border-t border-emerald-100 dark:border-emerald-800 max-h-40 overflow-y-auto bg-white dark:bg-slate-800">
                          <pre className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{att.ocrText}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* In-progress uploads */}
              {liveUploadItems.length > 0 && (
                <div className="space-y-1.5">
                  {liveUploadItems.map(item => (
                    <div key={item.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden text-sm">
                      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-700">
                        <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="flex-1 truncate font-medium text-slate-700 dark:text-slate-200">{item.name}</span>
                        {item.loading
                          ? <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                          : item.error && <span className="text-[10px] text-red-500 shrink-0">{item.error}</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload button */}
              <button
                type="button"
                onClick={() => liveAttachmentInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg py-3 text-sm text-slate-500 dark:text-slate-400 hover:border-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors active:scale-[0.99] duration-150"
              >
                <Paperclip className="w-4 h-4" />
                ファイルを追加（ブラウザにドロップでも可）
              </button>
              <input
                ref={liveAttachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files: File[] = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length > 0) addLiveFiles(files);
                  e.target.value = '';
                }}
              />
          </div>

          </div>{/* end left column */}

          {/* RIGHT COLUMN: transcript */}
          <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">文字起こし</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
                  <button type="button" onClick={() => setFeedTab('tl')}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors ${feedTab === 'tl' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                    TL
                  </button>
                  <button type="button" onClick={() => setFeedTab('raw')}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors border-l border-slate-200 dark:border-slate-600 ${feedTab === 'raw' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                    原文
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest flex items-center">
                  <span className="w-4 h-4 rounded-full bg-emerald-500 mr-3 animate-pulse"></span>Live
                </span>
                <button
                  type="button"
                  onClick={() => setTranscriptFullscreen(true)}
                  title="全画面表示"
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90 duration-150"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-6 min-h-[240px] max-h-[55vh] overflow-y-auto">
              {liveText === '待機中...' ? (
                <p className="text-slate-400 italic text-center mt-8 text-sm">録音開始を待機中...</p>
              ) : feedTab === 'tl' ? (
                timedLines.length > 0 ? (
                  <div className="space-y-3">
                    {timedLines.map((line, i) => (
                      <div key={i} className="flex gap-2.5 items-start text-sm">
                        <span className="text-[11px] text-blue-500 dark:text-blue-400 shrink-0 mt-0.5 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded tabular-nums">
                          {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                        </span>
                        <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : liveText ? (
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans text-sm">{liveText}</p>
                ) : (
                  <p className="text-slate-400 italic text-center mt-8 text-sm">文字起こしはまだありません。</p>
                )
              ) : (
                liveText ? (
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{liveText}</p>
                ) : (
                  <p className="text-slate-400 italic text-center mt-8 text-sm">文字起こしはまだありません。</p>
                )
              )}
            </div>
          </div>

          {/* Transcript fullscreen overlay */}
          {transcriptFullscreen && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setTranscriptFullscreen(false)}>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-[1344px] max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800 shrink-0">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">文字起こし</h2>
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
                      <button type="button" onClick={() => setFeedTab('tl')}
                        className={`px-4 py-1.5 text-xs font-bold transition-colors ${feedTab === 'tl' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                        TL
                      </button>
                      <button type="button" onClick={() => setFeedTab('raw')}
                        className={`px-4 py-1.5 text-xs font-bold transition-colors border-l border-slate-200 dark:border-slate-600 ${feedTab === 'raw' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                        原文
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTranscriptFullscreen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90 duration-150"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {liveText === '待機中...' ? (
                    <p className="text-slate-400 italic text-center mt-8 text-sm">録音開始を待機中...</p>
                  ) : feedTab === 'tl' ? (
                    timedLines.length > 0 ? (
                      <div className="space-y-3">
                        {timedLines.map((line, i) => (
                          <div key={i} className="flex gap-2.5 items-start text-sm">
                            <span className="text-[11px] text-blue-500 dark:text-blue-400 shrink-0 mt-0.5 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded tabular-nums">
                              {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                            </span>
                            <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{line.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : liveText ? (
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans text-sm">{liveText}</p>
                    ) : (
                      <p className="text-slate-400 italic text-center mt-8 text-sm">文字起こしはまだありません。</p>
                    )
                  ) : (
                    liveText ? (
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{liveText}</p>
                    ) : (
                      <p className="text-slate-400 italic text-center mt-8 text-sm">文字起こしはまだありません。</p>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          </div>{/* end 2-column grid */}

          {/* Gemini Assistant (full width below) */}
          <GeminiAssistant
            liveText={liveText && liveText !== '待機中...' ? liveText : null}
            triggerWord={triggerWord}
            sessionId={sessionId}
            customerNumber={selectedCustomer?.number}
            solveRef={geminiSolveRef}
          />
        </div>
      )}
      {preview && (
        <AttachmentPreviewModal url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
