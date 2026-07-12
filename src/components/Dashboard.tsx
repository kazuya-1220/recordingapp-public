import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { Recording } from '../types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Cloud, RefreshCw, CheckCircle2, Search, Filter, ExternalLink, Paperclip, ChevronDown, X, Users, Building2, FileText, AlertTriangle, Sparkles, Save, MessageSquare, Pencil, Loader2, Download, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { getKintoneSettings } from '../lib/kintone';
import { TAX_BRAIN_MEMBERS, getEmailByName } from '../lib/members';
import { AttachmentPreviewModal, downloadAttachment, openAttachmentInPlace } from './AttachmentPreviewModal';

function highlightText(text: string, kw1?: string | null, kw2?: string | null): React.ReactNode {
  const kw = kw1?.trim() || kw2?.trim();
  if (!kw || !text) return text;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length <= 1) return text;
  const lower = kw.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower
          ? <mark key={i} style={{ backgroundColor: 'rgb(249, 193, 207)', borderRadius: '2px', padding: '0 2px' }} className="text-slate-900">{part}</mark>
          : part
      )}
    </>
  );
}

export function Dashboard({ onViewChange, user, onUnsyncedChange, focusRecordId }: { onViewChange: (view: ViewState) => void; user: FirebaseUser | null; onUnsyncedChange?: (v: boolean) => void; focusRecordId?: string | null }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [textTabs, setTextTabs] = useState<Record<string, 'raw' | 'formatted' | 'timeline'>>({});
  const [transcriptPopup, setTranscriptPopup] = useState<string | null>(null);
  const [popupFontSize, setPopupFontSize] = useState(14);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Table sort + pagination + row expand
  const PAGE_SIZE = 30;
  const [sortCol, setSortCol] = useState<'createdAt' | 'customerName' | 'title' | 'summary'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalFullscreen, setModalFullscreen] = useState(false);

  const getActiveTab = (rec: Recording): 'raw' | 'formatted' | 'timeline' => {
    if (textTabs[rec.id]) return textTabs[rec.id];
    if (rec.formattedText) return 'formatted';
    return 'raw';
  };

  // Deep-linked focus: scroll + flash on first render once the target record loads
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrolledOnceRef = useRef(false);

  useEffect(() => {
    if (scrolledOnceRef.current) return;
    if (!focusRecordId) return;
    if (!recordings.some(r => r.id === focusRecordId)) return;
    scrolledOnceRef.current = true;
    // Wait for the card to be in the DOM before scrolling
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`rec-${focusRecordId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlashId(focusRecordId);
      window.setTimeout(() => setFlashId(null), 2500);
    });
    return () => cancelAnimationFrame(raf);
  }, [recordings, focusRecordId]);

  // Tab State: "すべて" (all), "Kintone未送信" (unsynced)
  const [activeTab, setActiveTab] = useState<'all' | 'unsynced'>('all');

  // Search/Filter states
  const [tempFreeWord, setTempFreeWord] = useState('');
  const [tempCustomerNo, setTempCustomerNo] = useState('');
  const [tempCustomerName, setTempCustomerName] = useState('');
  const [participantInput, setParticipantInput] = useState(''); // typed text in participant combobox
  const [tempParticipants, setTempParticipants] = useState<string[]>([]);
  const [tempSummaryWord, setTempSummaryWord] = useState('');
  const [tempRawWord, setTempRawWord] = useState('');
  const [tempStartDate, setTempStartDate] = useState<string | null>(null); // Format YYYY-MM-DD
  const [tempEndDate, setTempEndDate] = useState<string | null>(null); // Format YYYY-MM-DD

  const [appliedFreeWord, setAppliedFreeWord] = useState('');
  const [appliedCustomerNo, setAppliedCustomerNo] = useState('');
  const [appliedCustomerName, setAppliedCustomerName] = useState('');
  const [appliedParticipants, setAppliedParticipants] = useState<string[]>([]);
  const [participantMatchMode, setParticipantMatchMode] = useState<'includes' | 'exact'>('includes');
  const [appliedSummaryWord, setAppliedSummaryWord] = useState('');
  const [appliedRawWord, setAppliedRawWord] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState<string | null>(null);
  const [appliedEndDate, setAppliedEndDate] = useState<string | null>(null);

  // Calendar navigation state
  const [calMonth, setCalMonth] = useState<Date>(new Date());

  // Calendar drag-to-select-range state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);

  // UI toggle states
  const [showFilters, setShowFilters] = useState(false);

  // Autocomplete (combobox) UI states + outside-click refs
  const [showParticipantList, setShowParticipantList] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const participantBoxRef = useRef<HTMLDivElement>(null);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'recordings'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Recording[];
      
      // Sort client-side to avoid composite index requirement
      data.sort((a, b) => b.createdAt - a.createdAt);
      setRecordings(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'recordings');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Notify parent when unsynced state changes
  useEffect(() => {
    if (onUnsyncedChange) {
      onUnsyncedChange(recordings.some(r => !r.kintoneSynced));
    }
  }, [recordings, onUnsyncedChange]);

  // Autocomplete option lists (deduplicated, recency-ordered — recordings are newest-first)
  const participantOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    recordings.forEach(rec => {
      rec.participants?.forEach(p => {
        const name = p?.trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          list.push(name);
        }
      });
    });
    return list;
  }, [recordings]);

  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { name: string; number?: string }[] = [];
    recordings.forEach(rec => {
      const name = rec.customerName?.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        list.push({ name, number: rec.customerNumber });
      }
    });
    return list;
  }, [recordings]);

  // Outside-click to close the combobox dropdowns
  useEffect(() => {
    if (!showParticipantList) return;
    const handler = (e: MouseEvent) => {
      if (participantBoxRef.current && !participantBoxRef.current.contains(e.target as Node)) {
        setShowParticipantList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showParticipantList]);

  useEffect(() => {
    if (!showCustomerList) return;
    const handler = (e: MouseEvent) => {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) {
        setShowCustomerList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCustomerList]);

  // Commit a calendar drag-range on mouseup anywhere (in case the pointer is
  // released outside the calendar grid).
  useEffect(() => {
    if (!isDragging) return;
    const up = () => {
      if (dragStart) {
        const e2 = dragEnd ?? dragStart;
        const lo = dragStart <= e2 ? dragStart : e2;
        const hi = dragStart <= e2 ? e2 : dragStart;
        setTempStartDate(lo);
        setTempEndDate(hi);
      }
      setIsDragging(false);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [isDragging, dragStart, dragEnd]);

  const handleKintoneSync = async (recording: Recording) => {
    const settings = await getKintoneSettings();
    if (!settings.domain || !settings.appId || !settings.apiToken) {
      alert('Kintoneの設定が行われていません。管理者に設定を依頼してください。');
      return;
    }

    setSyncingId(recording.id);
    try {
      // Enrich the payload with derived fields the server needs (some may already
      // be on the recording, but old records saved before this schema won't have them).
      const participantEmails = recording.participantEmails
        ?? (recording.participants || [])
             .filter(p => TAX_BRAIN_MEMBERS.includes(p))
             .map(p => getEmailByName(p))
             .filter((e): e is string => !!e);

      const res = await fetch('/api/kintone/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          ...recording,
          participantEmails,
          appOrigin: window.location.origin,
        })
      });

      const resText = await res.text();
      let result: any;
      try {
        result = JSON.parse(resText);
      } catch (jsonErr) {
        result = null;
      }

      if (!res.ok) {
        throw new Error(result?.error || resText.slice(0, 500) || 'Unknown server error');
      }

      // Update Firestore status with synced flag, AI summary, and Kintone record URL
      try {
        await updateDoc(doc(db, 'recordings', recording.id), {
          kintoneSynced: true,
          summary: result?.summary || '',
          kintoneRecordUrl: result?.recordUrl || '',
          kintoneRecordId: result?.recordId ? String(result.recordId) : '',
        });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.UPDATE, `recordings/${recording.id}`);
      }

      alert('Kintoneへの連携とAI要約の保存が完了しました！');

      // Open the Kintone record in a new tab (browser only)
      if (result?.recordUrl) {
        window.open(result.recordUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      alert('Kintone連携に失敗しました: ' + e.message);
    } finally {
      setSyncingId(null);
    }
  };

  // Date Formatting Helper
  const getLocalDateString = (timestamp: number) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Extract all local dates that contain recording data
  const datesWithData = new Set<string>();
  const countPerDate = new Map<string, number>();
  recordings.forEach(rec => {
    const ds = getLocalDateString(rec.createdAt);
    datesWithData.add(ds);
    countPerDate.set(ds, (countPerDate.get(ds) || 0) + 1);
  });

  // Calendar Helpers
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay(); // 0 = Sun, 6 = Sat
  };

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const daysInMonth = getDaysInMonth(calMonth);
  const firstDayIndex = getFirstDayOfMonth(calMonth);

  const daysArray: (Date | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    daysArray.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    daysArray.push(new Date(year, month, d));
  }

  // Ordered range currently shown on the calendar. While dragging, preview the
  // drag selection; otherwise reflect the committed temp start/end.
  const calRange = (() => {
    const rawStart = isDragging ? dragStart : tempStartDate;
    const rawEnd = isDragging ? (dragEnd ?? dragStart) : (tempEndDate ?? tempStartDate);
    if (!rawStart && !rawEnd) return null;
    const a = rawStart ?? rawEnd!;
    const b = rawEnd ?? rawStart!;
    return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
  })();

  // Handle Search Apply
  const handleSearch = () => {
    setAppliedFreeWord(tempFreeWord);
    setAppliedCustomerNo(tempCustomerNo);
    setAppliedCustomerName(tempCustomerName);
    setAppliedParticipants(tempParticipants);
    setAppliedSummaryWord(tempSummaryWord);
    setAppliedRawWord(tempRawWord);
    setAppliedStartDate(tempStartDate);
    setAppliedEndDate(tempEndDate);
  };

  // Escape anywhere in the search/filter area closes the panel and any open dropdowns
  const handleSearchAreaKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowFilters(false);
      setShowParticipantList(false);
      setShowCustomerList(false);
    }
  };

  // Sort column toggle
  const handleSortCol = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setCurrentPage(1);
  };

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [appliedFreeWord, appliedCustomerNo, appliedCustomerName, appliedParticipants, appliedSummaryWord, appliedRawWord, appliedStartDate, appliedEndDate, activeTab]);

  // Reset every search condition (temp + applied) in one click
  const handleClearAll = () => {
    setTempFreeWord('');
    setTempCustomerNo('');
    setTempCustomerName('');
    setParticipantInput('');
    setTempParticipants([]);
    setTempSummaryWord('');
    setTempRawWord('');
    setTempStartDate(null);
    setTempEndDate(null);

    setAppliedFreeWord('');
    setAppliedCustomerNo('');
    setAppliedCustomerName('');
    setAppliedParticipants([]);
    setAppliedSummaryWord('');
    setAppliedRawWord('');
    setAppliedStartDate(null);
    setAppliedEndDate(null);

    setDragStart(null);
    setDragEnd(null);
    setIsDragging(false);

    setShowParticipantList(false);
    setShowCustomerList(false);
  };

  // Shared input styling
  const inputClass = "w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-3 rounded-lg text-sm focus:outline-none focus:border-blue-500";

  // Participant chip color: blue = internal staff, amber = external
  const participantChipClass = (p: string) =>
    TAX_BRAIN_MEMBERS.includes(p)
      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800'
      : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800';

  // Filtered combobox options based on the current typed value
  const filteredParticipantOptions = participantOptions.filter(p =>
    !participantInput.trim() || p.toLowerCase().includes(participantInput.toLowerCase())
  );

  // Toggle a participant in the selected (temp) set and apply immediately
  const toggleParticipant = (p: string) => {
    setTempParticipants(prev => {
      const next = prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p];
      setAppliedParticipants(next);
      return next;
    });
  };
  const filteredCustomerOptions = customerOptions.filter(c =>
    !tempCustomerName.trim() ||
    c.name.toLowerCase().includes(tempCustomerName.toLowerCase()) ||
    (c.number ?? '').toLowerCase().includes(tempCustomerName.toLowerCase())
  );
  const selectedCustomerNumber = customerOptions.find(c => c.name === appliedCustomerName)?.number;

  // Whether any ADVANCED (non-free-word) filter is set — drives the filter-toggle highlight/dot
  const advancedActive = !!(
    tempCustomerNo || tempCustomerName || tempParticipants.length || tempSummaryWord || tempRawWord || tempStartDate || tempEndDate ||
    appliedCustomerNo || appliedCustomerName || appliedParticipants.length || appliedSummaryWord || appliedRawWord || appliedStartDate || appliedEndDate
  );

  // Filter & Slice logic
  const filteredRecordings = recordings.filter(rec => {
    // 1. Tab filter
    if (activeTab === 'unsynced' && rec.kintoneSynced) return false;

    // 2. Free Word search — matches across EVERY searchable field
    if (appliedFreeWord.trim()) {
      const kw = appliedFreeWord.toLowerCase();
      const has = (s?: string | null) => !!s && s.toLowerCase().includes(kw);
      const match =
        has(rec.title) ||
        has(rec.text) ||
        has(rec.formattedText) ||
        has(rec.summary) ||
        has(rec.customerName) ||
        has(rec.customerNumber) ||
        (rec.participants?.some(p => p.toLowerCase().includes(kw)) ?? false) ||
        (rec.attachments?.some(a => has(a.name) || has(a.ocrText)) ?? false);
      if (!match) return false;
    }

    // 3. Customer number search
    if (appliedCustomerNo.trim()) {
      const cno = appliedCustomerNo.toLowerCase();
      const noMatch = rec.customerNumber?.toLowerCase().includes(cno);
      if (!noMatch) return false;
    }

    // 4. Customer name search
    if (appliedCustomerName.trim()) {
      const cname = appliedCustomerName.toLowerCase();
      const nameMatch = rec.customerName?.toLowerCase().includes(cname);
      if (!nameMatch) return false;
    }

    // 5. Participant search (multi-select, includes / exact match modes)
    if (appliedParticipants.length > 0) {
      const selected = appliedParticipants.map(s => s.toLowerCase());
      const pMatch = rec.participants?.some(p => {
        const pl = p.toLowerCase();
        return participantMatchMode === 'exact'
          ? selected.some(s => pl === s)
          : selected.some(s => pl.includes(s));
      });
      if (!pMatch) return false;
    }

    // 5b. Summary-scoped search
    if (appliedSummaryWord.trim()) {
      const kw = appliedSummaryWord.toLowerCase();
      if (!rec.summary?.toLowerCase().includes(kw)) return false;
    }

    // 5c. Raw transcription-scoped search (raw text + formatted text)
    if (appliedRawWord.trim()) {
      const kw = appliedRawWord.toLowerCase();
      const match = (rec.text?.toLowerCase().includes(kw)) || (rec.formattedText?.toLowerCase().includes(kw));
      if (!match) return false;
    }

    // 6. Date Range Search (Calendar) — inclusive [start, end]. If only one bound
    //    is set, treat it as an exact single day (start === end).
    if (appliedStartDate || appliedEndDate) {
      const start = appliedStartDate ?? appliedEndDate!;
      const end = appliedEndDate ?? appliedStartDate!;
      const lo = start <= end ? start : end;
      const hi = start <= end ? end : start;
      const recDateStr = getLocalDateString(rec.createdAt);
      if (recDateStr < lo || recDateStr > hi) return false;
    }

    return true;
  });

  // Sort + paginate
  const sortedFiltered = useMemo(() => {
    const arr = [...filteredRecordings];
    arr.sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortCol === 'createdAt') { av = a.createdAt; bv = b.createdAt; }
      else if (sortCol === 'customerName') { av = a.customerName || ''; bv = b.customerName || ''; }
      else if (sortCol === 'title') { av = a.title || ''; bv = b.title || ''; }
      else { av = a.summary || ''; bv = b.summary || ''; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredRecordings, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / PAGE_SIZE));
  const displayedRecordings = sortedFiltered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // --- Pink match-highlight helpers (Change 2) ---
  // Case-insensitive substring test that is inert when either side is empty.
  const inc = (s?: string | null, kw?: string | null) => !!s && !!kw && s.toLowerCase().includes(kw.toLowerCase());
  const fw = appliedFreeWord.trim();
  const pinkStyle = { backgroundColor: 'rgb(249, 193, 207)' };
  // Applied only when a highlight is active; keeps text dark & readable on pink.
  const pinkClass = 'text-slate-900 rounded px-1 py-0.5';

  const custNoHighlighted = (no?: string | null) => inc(no, appliedCustomerNo) || inc(no, fw);
  const custNameHighlighted = (name?: string | null) => inc(name, appliedCustomerName) || inc(name, fw);
  const participantHighlighted = (p: string) => {
    if (appliedParticipants.length) {
      const pl = p.toLowerCase();
      const matched = appliedParticipants.some(s =>
        participantMatchMode === 'exact' ? pl === s.toLowerCase() : pl.includes(s.toLowerCase())
      );
      if (matched) return true;
    }
    return inc(p, fw);
  };
  const attachmentHighlighted = (name?: string | null, ocr?: string | null) => inc(name, fw) || inc(ocr, fw);
  const transcriptMatched = (rec: Recording) =>
    inc(rec.text, fw) || inc(rec.formattedText, fw) || inc(rec.text, appliedRawWord) || inc(rec.formattedText, appliedRawWord);
  const summaryMatched = (rec: Recording) => inc(rec.summary, fw) || inc(rec.summary, appliedSummaryWord);

  return (
    <div className="space-y-6 pb-6">
      {/* Search & Tabs (Sticky & Scroll-Locked at Page Top) */}
      <div
        className="sticky top-14 bg-slate-50 dark:bg-slate-900 z-10 -mx-4 px-4 py-3 md:py-4 md:-mx-8 md:px-8 border-b border-slate-200 dark:border-slate-700 shadow-sm mb-6 space-y-3 md:space-y-4 max-h-[calc(100svh-13rem)] md:max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* (1) Title */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">レコード履歴</h2>
        </div>

        {/* (2) Search & Filter (flat — no frame) */}
        <div className="space-y-3" onKeyDown={handleSearchAreaKeyDown}>
          {/* Main search row (always visible) */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={tempFreeWord}
                onChange={(e) => setTempFreeWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="すべてから検索（顧客・参加者・内容・ファイル）..."
                className="flex-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-3 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`relative flex items-center justify-center p-3 rounded-lg border transition-colors ${
                  showFilters || advancedActive
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Filter className="w-4 h-4" />
                {advancedActive && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-600 rounded-full" />
                )}
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                title="フィルターをリセット"
                className="flex items-center justify-center p-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
            {/* Sort controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0">並び替え:</span>
              {([
                { col: 'createdAt' as const, label: '日時' },
                { col: 'customerName' as const, label: '顧客名' },
                { col: 'summary' as const, label: 'AI要約' },
              ]).map(({ col, label }) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => handleSortCol(col)}
                  className={`flex items-center gap-1 text-xs font-bold px-5 py-2 rounded-lg border transition-colors ${
                    sortCol === col
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600'
                  }`}
                >
                  {label}
                  {sortCol === col ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                  ) : (
                    <ChevronsUpDown className="w-3 h-3 opacity-50" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Expandable filter section */}
          {showFilters && (
            <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-700">
              {/* 顧客 group */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <Building2 className="w-3.5 h-3.5" />
                  顧客
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={tempCustomerNo}
                    onChange={(e) => setTempCustomerNo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="顧問先番号..."
                    className={inputClass}
                  />
                  {/* Customer name combobox */}
                  <div className="relative" ref={customerBoxRef}>
                    {appliedCustomerName ? (
                      <span className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg font-semibold border bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600">
                        {selectedCustomerNumber && <span className="text-slate-400 dark:text-slate-500 font-mono text-xs">{selectedCustomerNumber}</span>}
                        {appliedCustomerName}
                        <button
                          type="button"
                          onClick={() => { setTempCustomerName(''); setAppliedCustomerName(''); }}
                          className="hover:opacity-60"
                          aria-label="顧客名フィルターを解除"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={tempCustomerName}
                          onChange={(e) => { setTempCustomerName(e.target.value); setShowCustomerList(true); }}
                          onFocus={() => setShowCustomerList(true)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { setAppliedCustomerName(tempCustomerName); setShowCustomerList(false); handleSearch(); } }}
                          placeholder="顧客名で絞り込む..."
                          className={inputClass}
                        />
                        {showCustomerList && filteredCustomerOptions.length > 0 && (
                          <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg py-1">
                            {filteredCustomerOptions.map((c, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => { setTempCustomerName(c.name); setAppliedCustomerName(c.name); setShowCustomerList(false); }}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-2"
                              >
                                {c.number && <span className="text-xs text-slate-400 dark:text-slate-500 font-mono shrink-0">{c.number}</span>}
                                <span className="truncate">{c.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 参加者 group */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                    <Users className="w-3.5 h-3.5" />
                    参加者
                  </div>
                  {/* 含む / 完全一致 toggle switch */}
                  <div className="flex text-xs border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setParticipantMatchMode('includes')}
                      className={`px-3 py-1 font-bold transition-colors ${participantMatchMode === 'includes' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >含む</button>
                    <button
                      type="button"
                      onClick={() => setParticipantMatchMode('exact')}
                      className={`px-3 py-1 font-bold transition-colors ${participantMatchMode === 'exact' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >完全一致</button>
                  </div>
                </div>

                {/* Selected participant chips (removable) */}
                {tempParticipants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tempParticipants.map((p, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${participantChipClass(p)}`}>
                        {p}
                        <button
                          type="button"
                          onClick={() => toggleParticipant(p)}
                          className="hover:opacity-60"
                          aria-label={`${p} を解除`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="relative" ref={participantBoxRef}>
                  <input
                    type="text"
                    value={participantInput}
                    onChange={(e) => { setParticipantInput(e.target.value); setShowParticipantList(true); }}
                    onFocus={() => setShowParticipantList(true)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="参加者名で絞り込む（複数選択可）..."
                    className={inputClass}
                  />
                  {showParticipantList && filteredParticipantOptions.length > 0 && (
                    <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {filteredParticipantOptions.map((p, i) => {
                          const selected = tempParticipants.includes(p);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => toggleParticipant(p)}
                              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border transition-transform hover:scale-105 ${participantChipClass(p)} ${selected ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}
                            >
                              {selected && <CheckCircle2 className="w-3 h-3" />}
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 内容 group */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <FileText className="w-3.5 h-3.5" />
                  内容
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={tempSummaryWord}
                    onChange={(e) => setTempSummaryWord(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="要約から検索..."
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={tempRawWord}
                    onChange={(e) => setTempRawWord(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="文字起こし原文から検索..."
                    className={inputClass}
                  />
                </div>
              </div>

              {/* 日付 group */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    日付{(tempStartDate || tempEndDate) ? `：${tempStartDate ?? tempEndDate}${tempEndDate && tempEndDate !== tempStartDate ? ` 〜 ${tempEndDate}` : ''}` : ''}
                  </div>
                  {(tempStartDate || tempEndDate) && (
                    <button
                      type="button"
                      onClick={() => { setTempStartDate(null); setTempEndDate(null); setDragStart(null); setDragEnd(null); setIsDragging(false); }}
                      className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-lg font-bold hover:bg-blue-200 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 whitespace-nowrap"
                    >
                      解除
                    </button>
                  )}
                </div>

                {/* Native date range inputs (device-native calendar/picker on mobile) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    開始日
                    <input
                      type="date"
                      value={tempStartDate ?? ''}
                      onChange={(e) => setTempStartDate(e.target.value || null)}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    終了日
                    <input
                      type="date"
                      value={tempEndDate ?? ''}
                      onChange={(e) => setTempEndDate(e.target.value || null)}
                      className={inputClass}
                    />
                  </label>
                </div>

              {/* Calendar (always visible while filter panel is open) */}
              {(
                <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-3 bg-slate-50/50 dark:bg-slate-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                      className="text-slate-500 hover:text-slate-800 font-bold p-2 hover:bg-slate-200 rounded transition-colors"
                    >
                      &lt;
                    </button>
                    <span className="text-sm font-bold text-slate-700">
                      {format(calMonth, 'yyyy年MM月', { locale: ja })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                      className="text-slate-500 hover:text-slate-800 font-bold p-2 hover:bg-slate-200 rounded transition-colors"
                    >
                      &gt;
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400 mb-2">
                    {['日', '月', '火', '水', '木', '金', '土'].map(d => (
                      <div key={d} className="py-1">{d}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center">
                    {daysArray.map((day, idx) => {
                      if (!day) return <div key={`empty-${idx}`} />;

                      const dateStr = getLocalDateString(day.getTime());
                      const hasData = datesWithData.has(dateStr);
                      const inRange = !!calRange && dateStr >= calRange.lo && dateStr <= calRange.hi;
                      const isEndpoint = !!calRange && (dateStr === calRange.lo || dateStr === calRange.hi);

                      let cellClass = "relative text-sm py-2 rounded-lg transition-colors cursor-pointer select-none font-medium ";
                      if (isEndpoint) {
                        cellClass += "bg-blue-600 text-white";
                      } else if (inRange) {
                        cellClass += "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200";
                      } else if (hasData) {
                        cellClass += "bg-blue-100 text-blue-800 hover:bg-blue-200 border border-blue-300 font-bold dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
                      } else {
                        cellClass += "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600";
                      }

                      return (
                        <button
                          key={dateStr}
                          type="button"
                          onMouseDown={() => { setIsDragging(true); setDragStart(dateStr); setDragEnd(dateStr); }}
                          onMouseEnter={() => { if (isDragging) setDragEnd(dateStr); }}
                          className={cellClass}
                          title={hasData ? `録音データ ${countPerDate.get(dateStr)}件` : undefined}
                        >
                          <div className="flex flex-col items-center justify-start">
                            <span>{day.getDate()}</span>
                          </div>
                          {hasData && (
                            <span className={`absolute bottom-0.5 left-0 right-0 text-center text-[10px] font-bold leading-none ${isEndpoint ? 'text-blue-100' : 'text-blue-600 dark:text-blue-300'}`}>
                              {countPerDate.get(dateStr)}件
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>

              {/* Apply / Reset */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => { handleSearch(); setShowFilters(false); }}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  <Search className="w-4 h-4" />
                  絞り込みを適用
                </button>
                <button
                  type="button"
                  onClick={() => { handleClearAll(); setShowFilters(false); }}
                  className="w-full py-2.5 text-sm font-bold transition-colors border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4" />
                  フィルターをリセット
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* (3) Tab switcher (normal flow — NOT sticky, scrolls away with content) */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 -mt-2 mb-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 text-center py-3 text-sm font-bold transition-all border-b-2 ${
              activeTab === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
            }`}
          >
            すべて
          </button>
          <button
            onClick={() => setActiveTab('unsynced')}
            className={`flex-1 text-center py-3 text-sm font-bold transition-all border-b-2 relative ${
              activeTab === 'unsynced'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
            }`}
          >
            <span>未送信</span>
            {recordings.some(r => !r.kintoneSynced) && <span className="absolute top-3 right-4 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
          </button>
        </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      ) : sortedFiltered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700 border-dashed">
          <Cloud className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">該当する記録が見つかりません</p>
          <p className="text-xs text-slate-400 mt-1">検索条件を変更するか、録音を行ってください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Top pagination */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />前へ
              </button>
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">{currentPage}/{totalPages}ページ</span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-30 transition-colors"
              >
                次へ<ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {sortedFiltered.length}件中 {(currentPage - 1) * PAGE_SIZE + 1}〜{Math.min(currentPage * PAGE_SIZE, sortedFiltered.length)}件表示
            </span>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(100dvh - 360px)' }}>
              <table className="w-full text-sm table-fixed">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-700">
                    <th className="pl-2 pr-1 py-3 w-8"></th>
                    {([
                      { col: 'createdAt' as const, label: '日時', width: 'w-[4.75rem] md:w-24' },
                      { col: 'customerName' as const, label: '顧客名', width: 'w-[6.5rem] md:w-56' },
                      { col: 'summary' as const, label: 'AI要約', width: '' },
                    ]).map(({ col, label, width }) => (
                      <th
                        key={col}
                        onClick={() => handleSortCol(col)}
                        className={`text-left px-2 md:px-4 py-3 text-[11px] md:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-800 dark:hover:text-slate-100 select-none whitespace-nowrap ${width}`}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          {sortCol === col ? (
                            sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {displayedRecordings.map(rec => (
                    <tr
                      key={rec.id}
                      id={`rec-${rec.id}`}
                      className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30 ${
                        flashId === rec.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      } ${expandedId === rec.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    >
                      <td className="pl-2 pr-1 py-3 align-middle w-8">
                        <button
                          type="button"
                          onClick={() => { setExpandedId(rec.id); setModalFullscreen(false); }}
                          className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          title="詳細を表示"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="px-2 md:px-4 py-3 whitespace-nowrap align-middle cursor-pointer" onClick={() => { setExpandedId(rec.id); setModalFullscreen(false); }}>
                        <div className="text-[11px] md:text-sm font-medium text-slate-700 dark:text-slate-200">{format(rec.createdAt, 'yyyy/MM/dd', { locale: ja })}</div>
                        <div className="text-[11px] md:text-sm text-slate-700 dark:text-slate-200">{format(rec.createdAt, 'HH:mm', { locale: ja })}</div>
                      </td>
                      <td className="px-2 md:px-4 py-3 align-middle">
                        {rec.customerName ? (
                          <button
                            type="button"
                            title="このお客様でフィルター"
                            onClick={() => { setTempCustomerName(rec.customerName); setAppliedCustomerName(rec.customerName); setCurrentPage(1); }}
                            className="w-full min-w-0 text-left hover:opacity-70 transition-opacity active:scale-95 duration-100"
                          >
                            {rec.customerNumber && <div className="text-[10px] md:text-xs text-blue-500 dark:text-blue-400 font-mono truncate">{rec.customerNumber}</div>}
                            <div className="text-xs md:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{rec.customerName}</div>
                          </button>
                        ) : (
                          <span className="text-slate-400 italic text-xs md:text-sm cursor-pointer" onClick={() => { setExpandedId(rec.id); setModalFullscreen(false); }}>未設定</span>
                        )}
                      </td>
                      <td className="px-2 md:px-4 py-3 align-middle cursor-pointer" onClick={() => { setExpandedId(rec.id); setModalFullscreen(false); }}>
                        <div className="text-xs md:text-sm text-slate-600 dark:text-slate-300 line-clamp-2 break-words">{rec.summary ? rec.summary.slice(0, 100) + (rec.summary.length > 100 ? '…' : '') : <span className="text-slate-400 italic">—</span>}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />前へ
              </button>
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{currentPage}/{totalPages}ページ</span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-30 transition-colors"
              >
                次へ<ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      )}

      {/* Record detail modal */}
      {expandedId && (() => {
        const rec = recordings.find(r => r.id === expandedId);
        if (!rec) return null;
        const atts = rec.attachments?.length
          ? rec.attachments
          : rec.attachmentUrl
          ? [{ url: rec.attachmentUrl, name: rec.attachmentName || 'ファイル', ocrText: null as string | null | undefined }]
          : [];
        return (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-end md:items-center justify-center p-0 md:p-6" onClick={() => setExpandedId(null)}>
            <div
              className={`bg-white dark:bg-slate-800 shadow-2xl flex flex-col ${
                modalFullscreen
                  ? 'fixed inset-0 z-[61] rounded-none'
                  : 'rounded-t-2xl md:rounded-2xl w-full max-w-6xl max-h-[92dvh] md:max-h-[90dvh]'
              }`}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{format(rec.createdAt, 'yyyy年MM月dd日 HH:mm:ss', { locale: ja })}</p>
                  {rec.customerName ? (
                    <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {rec.customerNumber && <span className="text-blue-500 dark:text-blue-400 font-mono text-sm mr-2">{rec.customerNumber}</span>}
                      {rec.customerName}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400 italic mt-0.5">顧問先未設定</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rec.kintoneSynced ? (
                    <span className="flex items-center text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-full">
                      <CheckCircle2 className="w-4 h-4 mr-1" />送信済み
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleKintoneSync(rec); }}
                      disabled={syncingId === rec.id}
                      className="text-sm font-bold disabled:opacity-50 px-4 py-2 rounded-lg transition-all flex items-center gap-1.5"
                      style={{ backgroundColor: 'rgb(255, 204, 0)', color: '#1a1a1a' }}
                    >
                      {syncingId === rec.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                      Kintone送信
                    </button>
                  )}
                  {rec.kintoneRecordUrl && (
                    <a href={rec.kintoneRecordUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full hover:opacity-90" style={{ backgroundColor: 'rgb(255, 204, 0)', color: '#1a1a1a' }}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => setModalFullscreen(v => !v)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    title={modalFullscreen ? '元のサイズに戻す' : '全画面表示'}
                  >
                    {modalFullscreen
                      ? <Minimize2 className="w-5 h-5 text-slate-500" />
                      : <Maximize2 className="w-5 h-5 text-slate-500" />}
                  </button>
                  <button onClick={() => setExpandedId(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Participants */}
                {rec.participants && rec.participants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rec.participants.map((p, i) => {
                      const isInternal = TAX_BRAIN_MEMBERS.includes(p);
                      return (
                        <span key={i} className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isInternal ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800'}`}>
                          {p}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Transcript */}
                <div className="bg-slate-50 dark:bg-slate-700 p-4 rounded-lg border border-slate-100 dark:border-slate-600">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">文字起こし</div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setTranscriptPopup(rec.id)} className="text-sm font-bold px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors">展開</button>
                      {(rec.formattedText || (rec.timedLines?.length ?? 0) > 0) && (
                        <div className="flex text-xs border border-slate-300 dark:border-slate-500 rounded-lg overflow-hidden">
                          {rec.formattedText && (
                            <button onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'formatted' }))} className={`px-3 py-1.5 font-bold transition-colors ${getActiveTab(rec) === 'formatted' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-600'}`}>整形済み</button>
                          )}
                          {(rec.timedLines?.length ?? 0) > 0 && (
                            <button onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'timeline' }))} className={`px-3 py-1.5 font-bold transition-colors ${getActiveTab(rec) === 'timeline' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-600'}`}>TL</button>
                          )}
                          <button onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'raw' }))} className={`px-3 py-1.5 font-bold transition-colors ${getActiveTab(rec) === 'raw' ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-slate-600'}`}>原文</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {getActiveTab(rec) === 'timeline' && (rec.timedLines?.length ?? 0) > 0 ? (
                    <div className="max-h-56 overflow-y-auto space-y-2">
                      {rec.timedLines!.map((line, i) => (
                        <div key={i} className="flex gap-2.5 items-start text-sm">
                          <button
                            type="button"
                            onClick={() => { const a = audioRefs.current.get(rec.id); if (a) { a.currentTime = line.ms / 1000; a.play().catch(() => {}); } }}
                            disabled={!rec.audioUrl}
                            className={`font-mono text-[11px] shrink-0 mt-0.5 px-1.5 py-0.5 rounded tabular-nums ${rec.audioUrl ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 cursor-pointer' : 'text-slate-400 bg-slate-100 dark:bg-slate-700 cursor-default'}`}
                          >
                            {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                          </button>
                          <span className="text-slate-600 dark:text-slate-300 leading-relaxed">{line.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {(getActiveTab(rec) === 'formatted' && rec.formattedText)
                        ? rec.formattedText
                        : rec.text || <span className="text-slate-400 italic">文字起こしデータはありません</span>}
                    </div>
                  )}
                </div>

                {/* AI Summary */}
                {rec.summary && (
                  <SummaryEditor
                    rec={rec}
                    userEmail={user?.email || ''}
                    matched={false}
                    pinkStyle={pinkStyle}
                    pinkClass={pinkClass}
                    summaryKeyword={undefined}
                  />
                )}

                {/* Gemini Assistant 結果 */}
                {rec.geminiResult && (
                  <div className="bg-violet-50 dark:bg-violet-900/20 p-4 rounded-lg border border-violet-100 dark:border-violet-800/40 space-y-2">
                    <div className="font-bold text-sm text-violet-800 dark:text-violet-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                      Gemini Assistant 調査結果
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                      {rec.geminiResult}
                    </div>
                  </div>
                )}

                {/* Audio */}
                {rec.audioUrl && (
                  <div className="bg-slate-50 dark:bg-slate-700 p-3 rounded-lg border border-slate-100 dark:border-slate-600">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">音声</div>
                    <audio controls className="w-full outline-none" src={rec.audioUrl} ref={(el) => { if (el) audioRefs.current.set(rec.id, el); else audioRefs.current.delete(rec.id); }} />
                  </div>
                )}

                {/* Attachments */}
                {atts.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                      <Paperclip className="w-3.5 h-3.5" />
                      添付ファイル ({atts.length})
                    </div>
                    {atts.map((att, idx) => {
                      const key = `modal-${rec.id}-${idx}`;
                      const isExpanded = expandedAttachments.has(key);
                      return (
                        <div key={idx} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden text-sm">
                          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-700">
                            <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                            <button
                              type="button"
                              onClick={() => { if (openAttachmentInPlace(att.url, att.name)) setPreview({ url: att.url, name: att.name }); }}
                              className="flex-1 truncate font-medium text-blue-600 dark:text-blue-400 hover:underline text-left"
                            >
                              {att.name}
                            </button>
                            <button type="button" title="ダウンロード" onClick={() => downloadAttachment(att.url, att.name)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors shrink-0">
                              <Download className="w-5 h-5" />
                            </button>
                            {att.ocrText && (
                              <button
                                type="button"
                                onClick={() => setExpandedAttachments(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
                                className="text-sm text-blue-600 dark:text-blue-400 font-bold px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 shrink-0 flex items-center gap-1"
                              >
                                OCR <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                          </div>
                          {isExpanded && att.ocrText && (
                            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-600 max-h-40 overflow-y-auto bg-white dark:bg-slate-800">
                              <pre className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{att.ocrText}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {preview && (
        <AttachmentPreviewModal url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
      )}

      {/* Transcript popup modal */}
      {transcriptPopup && (() => {
        const rec = recordings.find(r => r.id === transcriptPopup);
        if (!rec) return null;
        const activeTab = getActiveTab(rec);
        return (
          <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-3 md:p-6" onClick={() => setTranscriptPopup(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl h-[calc(100dvh-1.5rem)] md:h-[calc(100dvh-3rem)] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="text-sm font-bold text-slate-500 uppercase tracking-wide">文字起こし</div>
                <div className="flex items-center gap-2">
                  {/* Font size controls */}
                  <div className="flex items-center gap-1 mr-1 border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                    <button onClick={() => setPopupFontSize(s => Math.max(10, s - 2))} title="文字を小さく" className="px-2 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] font-mono text-slate-400 w-8 text-center">{popupFontSize}</span>
                    <button onClick={() => setPopupFontSize(s => Math.min(28, s + 2))} title="文字を大きく" className="px-2 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {(rec.formattedText || (rec.timedLines?.length ?? 0) > 0) && (
                    <div className="flex text-xs border border-slate-300 dark:border-slate-500 rounded-lg overflow-hidden">
                      {rec.formattedText && (
                        <button
                          onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'formatted' }))}
                          className={`px-4 py-1.5 font-bold transition-colors ${activeTab === 'formatted' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-600'}`}
                        >整形済み</button>
                      )}
                      {(rec.timedLines?.length ?? 0) > 0 && (
                        <button
                          onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'timeline' }))}
                          className={`px-4 py-1.5 font-bold transition-colors ${activeTab === 'timeline' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-600'}`}
                        >TL</button>
                      )}
                      <button
                        onClick={() => setTextTabs(prev => ({ ...prev, [rec.id]: 'raw' }))}
                        className={`px-4 py-1.5 font-bold transition-colors ${activeTab === 'raw' ? 'bg-slate-500 dark:bg-slate-400 text-white' : 'text-slate-400 hover:text-slate-600'}`}
                      >原文</button>
                    </div>
                  )}
                  <button onClick={() => setTranscriptPopup(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5 md:p-7">
                {activeTab === 'timeline' && (rec.timedLines?.length ?? 0) > 0 ? (
                  <div className="space-y-2" style={{ fontSize: `${popupFontSize}px` }}>
                    {rec.timedLines!.map((line, i) => (
                      <div key={i} className="flex gap-2.5 items-start">
                        <span className="font-mono shrink-0 mt-0.5 px-1.5 py-0.5 rounded tabular-nums text-slate-400 bg-slate-100 dark:bg-slate-700" style={{ fontSize: `${Math.max(10, popupFontSize - 2)}px` }}>
                          {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 leading-relaxed">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-slate-600 dark:text-slate-300 leading-relaxed" style={{ fontSize: `${popupFontSize}px` }}>
                    {(activeTab === 'formatted' && rec.formattedText)
                      ? rec.formattedText
                      : rec.text || <span className="text-slate-400 italic">文字起こしデータはありません</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// --- AI summary card sub-component ---------------------------------------
// Local state per card keeps re-renders isolated and avoids one big map on
// the Dashboard. Panels are mutually exclusive; the summary text hides while
// 直接編集 is open (its textarea replaces the summary body).
function SummaryEditor({
  rec,
  userEmail,
  matched,
  pinkStyle,
  pinkClass,
  summaryKeyword,
}: {
  rec: Recording;
  userEmail: string;
  matched: boolean;
  pinkStyle: React.CSSProperties;
  pinkClass: string;
  summaryKeyword?: string;
}) {
  const [panel, setPanel] = useState<'regen' | 'edit' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [editText, setEditText] = useState(rec.summary || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [expandedPrompts, setExpandedPrompts] = useState<Set<number>>(new Set());

  // Keep the edit textarea in sync when the underlying summary updates
  // (Firestore onSnapshot pushes new summaries) and the edit panel is closed.
  useEffect(() => {
    if (panel !== 'edit') setEditText(rec.summary || '');
  }, [rec.summary, panel]);

  const openPanel = (p: 'regen' | 'edit') => {
    setError(null);
    setSuccessMsg(null);
    setPanel(prev => (prev === p ? null : p));
    if (p === 'edit') setEditText(rec.summary || '');
  };

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleRegenerate = async () => {
    if (!prompt.trim()) {
      setError('プロンプトを入力してください');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const settings = await getKintoneSettings();
      const res = await fetch('/api/summary/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rec.id,
          prompt,
          user: userEmail,
          // context needed by the server to regenerate
          text: rec.text,
          formattedText: rec.formattedText,
          timedLines: rec.timedLines,
          customerName: rec.customerName,
          customerNumber: rec.customerNumber,
          participants: rec.participants,
          attachments: rec.attachments,
          createdAt: rec.createdAt,
          // if already synced, so the server can PUT-update the Kintone row
          kintoneRecordId: rec.kintoneRecordId,
          ...settings,
        }),
      });
      const resText = await res.text();
      let result: any;
      try { result = JSON.parse(resText); } catch { result = null; }
      if (!res.ok) {
        throw new Error(result?.error || resText.slice(0, 500) || 'Unknown server error');
      }
      const newSummary: string = result?.summary || '';
      const kintoneUpdated: boolean = !!result?.kintoneUpdated;
      // Server has no Firestore access — write the update from the client.
      try {
        await updateDoc(doc(db, 'recordings', rec.id), {
          summary: newSummary,
          summaryUpdateLog: [
            ...(rec.summaryUpdateLog || []),
            { at: Date.now(), user: userEmail, action: 'regenerate', prompt, kintoneUpdated },
          ],
        });
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.UPDATE, `recordings/${rec.id}`);
      }
      setPanel(null);
      setPrompt('');
      flashSuccess(kintoneUpdated ? 'Kintone も更新しました' : '更新しました');
    } catch (e: any) {
      setError(e?.message || '再生成に失敗しました');
    } finally {
      setPending(false);
    }
  };

  const handleSave = async () => {
    if (!editText.trim()) {
      setError('要約が空です');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const settings = await getKintoneSettings();
      const res = await fetch('/api/summary/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rec.id,
          summary: editText,
          user: userEmail,
          kintoneRecordId: rec.kintoneRecordId,
          ...settings,
        }),
      });
      const resText = await res.text();
      let result: any;
      try { result = JSON.parse(resText); } catch { result = null; }
      if (!res.ok) {
        throw new Error(result?.error || resText.slice(0, 500) || 'Unknown server error');
      }
      const kintoneUpdated: boolean = !!result?.kintoneUpdated;
      // Server has no Firestore access — write the update from the client.
      try {
        await updateDoc(doc(db, 'recordings', rec.id), {
          summary: editText,
          summaryUpdateLog: [
            ...(rec.summaryUpdateLog || []),
            { at: Date.now(), user: userEmail, action: 'edit', kintoneUpdated },
          ],
        });
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.UPDATE, `recordings/${rec.id}`);
      }
      setPanel(null);
      flashSuccess(kintoneUpdated ? 'Kintone も更新しました' : '更新しました');
    } catch (e: any) {
      setError(e?.message || '保存に失敗しました');
    } finally {
      setPending(false);
    }
  };

  const log = rec.summaryUpdateLog ?? [];

  return (
    <div
      className={`bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800/40 space-y-2 ${matched ? 'border-l-4' : ''}`}
      style={matched ? { borderLeftColor: 'rgb(249, 193, 207)' } : undefined}
    >
      <div className="font-bold text-sm text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4 text-blue-600" />
        AI要約・セカンドアクション
        {matched && (
          <span style={pinkStyle} className={`text-[10px] font-bold ${pinkClass}`}>一致</span>
        )}
      </div>

      {/* Summary body (hidden while 直接編集 is open — the textarea replaces it) */}
      {panel !== 'edit' && (
        <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          {highlightText(rec.summary || '', summaryKeyword)}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => openPanel('regen')}
          disabled={pending}
          className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
            panel === 'regen'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-slate-800 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          AIで再生成
        </button>
        <button
          type="button"
          onClick={() => openPanel('edit')}
          disabled={pending}
          className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
            panel === 'edit'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-slate-800 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          直接編集
        </button>
        {successMsg && (
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {successMsg}
          </span>
        )}
      </div>

      {/* Regenerate panel */}
      {panel === 'regen' && (
        <div className="space-y-2 pt-1">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block">
            追加プロンプト（例：もっと簡潔に／〇〇についてより詳しく）
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={pending}
            className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-blue-500 disabled:opacity-60"
            placeholder="どのように再生成しますか？"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400 font-semibold">{error}</p>}
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={pending}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-colors"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            再生成
          </button>
        </div>
      )}

      {/* Edit panel */}
      {panel === 'edit' && (
        <div className="space-y-2 pt-1">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={8}
            disabled={pending}
            className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60 leading-relaxed"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400 font-semibold">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-colors"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存
          </button>
        </div>
      )}

      {/* Update log */}
      {log.length > 0 && (
        <div className="pt-2 border-t border-blue-100 dark:border-blue-800/40">
          <button
            type="button"
            onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            更新ログ ({log.length}件)
            <ChevronDown className={`w-3 h-3 transition-transform ${logOpen ? 'rotate-180' : ''}`} />
          </button>
          {logOpen && (
            <ul className="mt-1.5 space-y-1.5">
              {log.slice().sort((a, b) => b.at - a.at).map((entry, i) => {
                const isRegen = entry.action === 'regenerate';
                const promptShort = entry.prompt && entry.prompt.length > 60 ? entry.prompt.slice(0, 60) + '…' : entry.prompt;
                const isExpanded = expandedPrompts.has(i);
                return (
                  <li key={i} className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono tabular-nums">
                      {format(entry.at, 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">{entry.user}</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold ${isRegen ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                      {isRegen ? 'AI再生成' : '手動編集'}
                    </span>
                    {entry.kintoneUpdated && (
                      <span className="px-1.5 py-0.5 rounded font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        Kintone
                      </span>
                    )}
                    {isRegen && entry.prompt && (
                      <button
                        type="button"
                        onClick={() => setExpandedPrompts(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        })}
                        className="text-slate-600 dark:text-slate-300 italic hover:underline text-left"
                        title={entry.prompt.length > 60 ? 'クリックで展開' : undefined}
                      >
                        「{isExpanded ? entry.prompt : promptShort}」
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
