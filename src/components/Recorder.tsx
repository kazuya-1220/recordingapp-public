import React, { useState, useEffect, useRef } from 'react';
import { collection, doc, addDoc, getDoc, updateDoc, onSnapshot, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { ViewState } from '../App';
import { Square, Loader2, Save, Search, Users, UserPlus, X, Check, CircleDot, ChevronDown, Paperclip, RefreshCw, Pencil, Wand2, Trash2, Download, Maximize2, Mic } from 'lucide-react';
import { AttachmentPreviewModal, downloadAttachment, openAttachmentInPlace } from './AttachmentPreviewModal';
import { getKintoneSettings } from '../lib/kintone';
import { useRecording } from '../contexts/RecordingContext';
import { TAX_BRAIN_MEMBERS, memberMatchesQuery, getNameByEmail, getEmailByName } from '../lib/members';
import { loadUserPromptSettings, buildExtraInstruction } from './PromptSettings';
import { ScrollToTop } from './ScrollToTop';
import { GeminiAssistant } from './GeminiAssistant';
import { getAssistantSettings } from '../lib/assistant';

const NUM_BARS = 13;
const BAR_W = 4;
const BAR_GAP = 3;
const METER_W = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP;
const METER_H = 32;

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function AudioLevelMeter({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stream) return;

    let audioCtx: AudioContext | null = null;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { return; }

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.88;

    let source: MediaStreamAudioSourceNode;
    try {
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch { audioCtx.close(); return; }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const ctx = canvas.getContext('2d');
    if (!ctx) { audioCtx.close(); return; }

    const step = Math.max(1, Math.floor(dataArray.length / NUM_BARS));

    const FRAME_INTERVAL = 1000 / 16;
    let lastDrawTime = 0;

    const draw = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (timestamp - lastDrawTime < FRAME_INTERVAL) return;
      lastDrawTime = timestamp;

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, METER_W, METER_H);

      const NOISE_FLOOR = 0.18;
      for (let i = 0; i < NUM_BARS; i++) {
        const raw = (dataArray[i * step] ?? 0) / 255;
        const value = raw < NOISE_FLOOR ? 0 : (raw - NOISE_FLOOR) / (1 - NOISE_FLOOR);
        const barH = Math.max(3, Math.round(value * (METER_H - 6)));
        const x = i * (BAR_W + BAR_GAP);
        const y = (METER_H - barH) / 2;
        const lightness = 48 + Math.round(value * 18);
        ctx.fillStyle = `hsl(38, 92%, ${lightness}%)`;
        const r = Math.min(2, BAR_W / 2, barH / 2);
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, BAR_W, barH, r);
        } else {
          ctx.rect(x, y, BAR_W, barH);
        }
        ctx.fill();
      }
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { source.disconnect(); } catch {}
      audioCtx?.close();
    };
  }, [stream]);

  return (
    <div className="flex items-center justify-center bg-slate-950 rounded-full px-5 py-2.5">
      <canvas ref={canvasRef} width={METER_W} height={METER_H} />
    </div>
  );
}

type FSAttachment = { url: string; name: string; ocrText: string | null };

interface AttachmentItem {
  id: string;
  file: File;
  url?: string | null;
  ocrText: string | null;
  ocrLoading: boolean;
  ocrError?: string;
  displayName: string;
  aiRenaming?: boolean;
}

export function Recorder({ onViewChange, user, isActive = true }: { onViewChange: (view: ViewState) => void; user: FirebaseUser; isActive?: boolean }) {
  const { isRecording, text, timedLines, sessionId, hasAudio, audioChunksRef, audioMimeTypeRef, mediaStreamRef, startRecording, resumeRecording, stopRecording, resetRecording } = useRecording();
  // Canonical name of the current user within the Tax Brain member list (resolved by
  // email, not Google displayName), so "自分" and the member-list entry are the SAME
  // stored value — important for history search and the Kintone API.
  const selfName = user ? (getNameByEmail((user.email || '').toLowerCase()) || user.displayName || '') : '';
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // CRM sync success popup (shown after POST /api/kintone/sync returns success)
  const [syncSuccess, setSyncSuccess] = useState<{ summary: string; recordUrl: string | null } | null>(null);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [feedTab, setFeedTab] = useState<'tl' | 'raw'>('tl');
  const [triggerWord] = useState(() => getAssistantSettings().triggerWord);
  const [transcriptFullscreen, setTranscriptFullscreen] = useState(false);
  const [micLabel, setMicLabel] = useState('');
  const lastActivityRef = useRef(Date.now());
  const prevTextLenRef = useRef(0);
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([]);
  const [liveAttachments, setLiveAttachments] = useState<FSAttachment[]>([]);
  const [expandedOcr, setExpandedOcr] = useState<Set<string>>(new Set());
  const [editingAttId, setEditingAttId] = useState<string | null>(null);
  const [editingAttName, setEditingAttName] = useState('');
  const [editingLiveUrl, setEditingLiveUrl] = useState<string | null>(null);
  const [editingLiveName, setEditingLiveName] = useState('');
  const [aiRenamingLiveUrls, setAiRenamingLiveUrls] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; name: string; revoke: boolean } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerListRef = useRef<HTMLDivElement>(null);
  const dragCountRef = useRef(0);
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const attachmentItemsRef = useRef<AttachmentItem[]>([]);
  const autoSaveRef = useRef(false);
  const saveRecordingRef = useRef<() => Promise<void>>(async () => {});
  const sessionIdRef = useRef<string | null>(null);

  // Kintone customer lookup
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

  useEffect(() => {
    async function loadConfig() {
      const config = await getKintoneSettings();
      setKintoneConfig(config);
    }
    loadConfig();

    if (selfName) {
      setParticipantsList([selfName]);
    }
  }, [user]);

  // Capture the active microphone device name while recording
  useEffect(() => {
    if (!isRecording) { setMicLabel(''); return; }
    const read = () => {
      const track = mediaStreamRef.current?.getAudioTracks?.()[0];
      if (track?.label) setMicLabel(track.label);
    };
    read();
    // The track label can populate a moment after the stream starts
    const t = setTimeout(read, 600);
    return () => clearTimeout(t);
  }, [isRecording]);

  // Debounced real-time customer search
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

  useEffect(() => { saveRecordingRef.current = saveRecording; });
  useEffect(() => { addFilesRef.current = addFiles; });
  useEffect(() => { attachmentItemsRef.current = attachmentItems; }, [attachmentItems]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Browser-wide drag-and-drop (only while this view is visible, so a drop
  // isn't uploaded by both the Recorder and a joined LiveView at once)
  useEffect(() => {
    if (!isActive) return;
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
      if (files.length > 0) addFilesRef.current(files);
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
  }, [isActive]);

  // Warn before closing the tab/browser while recording or with unsaved edits
  useEffect(() => {
    const hasUnsavedWork = isRecording || hasAudio || attachmentItems.length > 0;
    if (!hasUnsavedWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRecording, hasAudio, attachmentItems.length]);

  // Auto-save: triggered when MediaRecorder.onstop fires (hasAudio → true)
  useEffect(() => {
    if (hasAudio && !isRecording && autoSaveRef.current) {
      autoSaveRef.current = false;
      saveRecordingRef.current();
    }
  }, [hasAudio, isRecording]);

  // Reset silence timer whenever speech text grows
  useEffect(() => {
    if (text.length > prevTextLenRef.current) {
      prevTextLenRef.current = text.length;
      lastActivityRef.current = Date.now();
      setSilenceWarning(false);
    }
  }, [text]);

  // Sample the MediaStream's audio level while recording. Whenever the RMS
  // rises above a small threshold we treat that as real audio activity and
  // reset the silence timer — critical on mobile, where the Web Speech API
  // often stops emitting text even though the mic is still capturing audio.
  useEffect(() => {
    if (!isRecording) return;
    const stream = mediaStreamRef.current;
    if (!stream) return;
    let audioCtx: AudioContext | null = null;
    let raf = 0;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      // Threshold: 0.02 in normalized [0..1] — well above ambient noise, below
      // normal speech RMS. Tuned to be robust to phones held slightly away.
      const AUDIO_ACTIVE_RMS = 0.02;
      const sample = () => {
        raf = requestAnimationFrame(sample);
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        if (rms > AUDIO_ACTIVE_RMS) {
          lastActivityRef.current = Date.now();
          setSilenceWarning(prev => (prev ? false : prev));
        }
      };
      raf = requestAnimationFrame(sample);
    } catch (e) {
      console.warn('[silence-detect] AudioContext unavailable:', e);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      audioCtx?.close().catch(() => {});
    };
  }, [isRecording, mediaStreamRef]);

  // Poll for silence while recording (either mic level low OR no transcription
  // growth for >30s — bumped from 10s because mobile speech recognition can
  // legitimately pause between segments).
  useEffect(() => {
    if (!isRecording) {
      setSilenceWarning(false);
      prevTextLenRef.current = 0;
      return;
    }
    lastActivityRef.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 30000) setSilenceWarning(true);
    }, 5000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Recording duration timer
  useEffect(() => {
    if (!isRecording) { setRecordingDuration(0); return; }
    const start = Date.now();
    const id = setInterval(() => setRecordingDuration(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Subscribe to live session for bidirectional sync with LiveView
  useEffect(() => {
    if (!sessionId) return;
    const unsubscribe = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.customerName) {
        setSelectedCustomer({ name: data.customerName, number: data.customerNumber || '', submitNo: data.customerSubmitNo || '' });
      } else if (data.customerName === '') {
        setSelectedCustomer(null);
      }
      if (data.participants && Array.isArray(data.participants)) {
        setParticipantsList(data.participants);
      }
      if (data.liveAttachments && Array.isArray(data.liveAttachments)) {
        setLiveAttachments(data.liveAttachments);
      }
      // Reconcile local attachmentItems against Firestore recorderAttachments
      // This handles deletions performed from the LiveView side
      if (data.recorderAttachments && Array.isArray(data.recorderAttachments)) {
        const keepUrls = new Set((data.recorderAttachments as any[]).map((a: any) => a.url));
        setAttachmentItems(prev => prev.filter(item => !item.url || keepUrls.has(item.url)));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `liveSessions/${sessionId}`);
    });
    return () => unsubscribe();
  }, [sessionId]);

  const syncSessionUpdate = async (data: Record<string, any>) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await setDoc(doc(db, 'liveSessions', sid), data, { merge: true });
    } catch (e) { console.warn('[Session sync]', e); }
  };

  const deleteLiveAttachment = (att: FSAttachment) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setDoc(doc(db, 'liveSessions', sid), {
      liveAttachments: arrayRemove(att)
    }, { merge: true }).catch(e => console.warn('[Delete live att]', e));
  };

  // Push the local attachment list to the live session's recorderAttachments so
  // renames/deletes sync to LiveView (rewrites the whole array, keyed by url).
  const syncRecorderAttachments = (items: AttachmentItem[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const arr = items
      .filter(i => i.url)
      .map(i => ({ url: i.url as string, name: i.displayName, ocrText: i.ocrText }));
    setDoc(doc(db, 'liveSessions', sid), { recorderAttachments: arr }, { merge: true })
      .catch(e => console.warn('[Recorder att sync]', e));
  };

  const saveAttachmentName = (id: string, name: string) => {
    const trimmed = name.trim();
    setEditingAttId(null);
    if (!trimmed) return;
    const next = attachmentItemsRef.current.map(a => a.id === id ? { ...a, displayName: trimmed } : a);
    setAttachmentItems(next);
    syncRecorderAttachments(next);
  };

  const aiRenameAttachment = async (item: AttachmentItem) => {
    setAttachmentItems(prev => prev.map(a => a.id === item.id ? { ...a, aiRenaming: true } : a));
    try {
      const res = await fetch('/api/rename-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.displayName, ocrText: item.ocrText })
      });
      const data = await res.json();
      if (res.ok && data.suggested) {
        const next = attachmentItemsRef.current.map(a => a.id === item.id ? { ...a, displayName: data.suggested, aiRenaming: false } : a);
        setAttachmentItems(next);
        syncRecorderAttachments(next);
      } else {
        setAttachmentItems(prev => prev.map(a => a.id === item.id ? { ...a, aiRenaming: false } : a));
      }
    } catch {
      setAttachmentItems(prev => prev.map(a => a.id === item.id ? { ...a, aiRenaming: false } : a));
    }
  };

  // Rename / AI-rename for LiveView-uploaded attachments (shared via Firestore,
  // so the change is executable from the Recorder screen too and syncs both ways)
  const renameLiveAttachment = (url: string, newName: string) => {
    const sid = sessionIdRef.current;
    const trimmed = newName.trim();
    setEditingLiveUrl(null);
    if (!sid || !trimmed) return;
    const next = liveAttachments.map(a => a.url === url ? { ...a, name: trimmed } : a);
    setLiveAttachments(next);
    setDoc(doc(db, 'liveSessions', sid), { liveAttachments: next }, { merge: true })
      .catch(e => console.warn('[Rename live att]', e));
  };

  const aiRenameLiveAttachment = async (att: FSAttachment) => {
    setAiRenamingLiveUrls(prev => new Set(prev).add(att.url));
    try {
      const res = await fetch('/api/rename-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: att.name, ocrText: att.ocrText })
      });
      const data = await res.json();
      if (res.ok && data.suggested) renameLiveAttachment(att.url, data.suggested);
    } catch { /* non-fatal */ }
    finally {
      setAiRenamingLiveUrls(prev => { const n = new Set(prev); n.delete(att.url); return n; });
    }
  };

  // Attachment preview / download (works for uploaded URLs and local Files).
  // On iOS we hand off to the system viewer; elsewhere we open our in-app modal.
  const openPreviewFile = (item: AttachmentItem) => {
    const url = item.url || URL.createObjectURL(item.file);
    const revoke = !item.url;
    const showModal = openAttachmentInPlace(url, item.displayName);
    if (showModal) {
      setPreview({ url, name: item.displayName, revoke });
    } else if (revoke) {
      // iOS handed off to a new tab immediately — release the blob URL after
      // giving the new tab a moment to grab it.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };
  const openPreviewAtt = (att: FSAttachment) => {
    const showModal = openAttachmentInPlace(att.url, att.name);
    if (showModal) setPreview({ url: att.url, name: att.name, revoke: false });
  };
  const closePreview = () => {
    setPreview(prev => { if (prev?.revoke) URL.revokeObjectURL(prev.url); return null; });
  };
  const downloadFileItem = (item: AttachmentItem) => {
    const url = item.url || URL.createObjectURL(item.file);
    downloadAttachment(url, item.displayName);
    if (!item.url) setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleCustomerInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (customers.length === 1) {
        const c = customers[0];
        setSelectedCustomer(c);
        setCustomers([]);
        setCustomerKeyword('');
        syncSessionUpdate({ customerName: c.name, customerNumber: c.number || '', customerSubmitNo: c.submitNo || '' });
      } else if (customers.length > 1) {
        (customerListRef.current?.querySelector('button') as HTMLElement | null)?.focus();
      }
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
      setLookupError('CRM設定が未設定です。管理者に確認してください。');
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
      if (!res.ok) throw new Error(data.error || '検索に失敗しました。');
      setCustomers(data.customers || []);
      if (!data.customers?.length) setLookupError('該当する顧客が見つかりませんでした。');
    } catch (err: any) {
      setLookupError(err.message || 'エラーが発生しました。');
    } finally {
      setIsSearchingCustomers(false);
    }
  };

  const handleStartRecording = async () => {
    setIsStarting(true);
    try {
      await startRecording();
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopRecording = () => {
    if (!window.confirm('録音を停止して保存・CRM送信しますか？')) return;
    autoSaveRef.current = true;
    stopRecording();
  };

  const handleReconnect = () => {
    setSilenceWarning(false);
    lastActivityRef.current = Date.now();
    resumeRecording();
  };

  const toggleMember = (name: string) => {
    const next = participantsList.includes(name)
      ? participantsList.filter(p => p !== name)
      : [...participantsList, name];
    setParticipantsList(next);
    syncSessionUpdate({ participants: next });
  };

  const addExternalParticipant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = participantInput.trim();
    if (!name || participantsList.includes(name)) return;
    const next = [...participantsList, name];
    setParticipantsList(next);
    setParticipantInput('');
    syncSessionUpdate({ participants: next });
  };

  const removeParticipant = (name: string) => {
    const next = participantsList.filter(p => p !== name);
    setParticipantsList(next);
    syncSessionUpdate({ participants: next });
  };

  const addFiles = async (files: File[]) => {
    const sid = sessionIdRef.current;
    const newItems: AttachmentItem[] = files.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      url: null,
      ocrText: null,
      ocrLoading: true,
      displayName: f.name,
    }));
    setAttachmentItems(prev => [...prev, ...newItems]);

    await Promise.all(newItems.map(async (item) => {
      const fd = new FormData();
      fd.append('files', item.file, item.file.name);
      try {
        const res = await fetch('/api/ocr', { method: 'POST', body: fd });
        const data = await res.json();
        const result = data.results?.[0];
        const url: string | null = result?.url ?? null;
        const ocrText: string | null = result?.ocrText ?? null;
        setAttachmentItems(prev => prev.map(a =>
          a.id === item.id
            ? { ...a, ocrLoading: false, ocrText, url, ocrError: result?.error }
            : a
        ));
        if (sid && url) {
          setDoc(doc(db, 'liveSessions', sid), {
            recorderAttachments: arrayUnion({ url, name: item.file.name, ocrText })
          }, { merge: true }).catch(e => console.warn('[Recorder att sync]', e));
        }
      } catch {
        setAttachmentItems(prev => prev.map(a =>
          a.id === item.id ? { ...a, ocrLoading: false, ocrError: 'OCRに失敗しました' } : a
        ));
      }
    }));
  };

  const saveRecording = async () => {
    if (audioChunksRef.current.length === 0 || !auth.currentUser) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const recordedAt = Date.now();
      const title = selectedCustomer
        ? `記録: ${selectedCustomer.name}様 (${new Date().toLocaleDateString('ja-JP')})`
        : `記録: ${new Date().toLocaleString('ja-JP')}`;

      // Use the container the browser actually recorded (iOS = audio/mp4,
      // Chrome = audio/webm). Saving iOS mp4 bytes under a .webm name with a
      // webm Content-Type makes the file unplayable, so derive both from here.
      const audioMime = (audioMimeTypeRef.current || 'audio/webm').split(';')[0];
      const EXT_BY_MIME: Record<string, string> = {
        'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac',
      };
      const audioExt = EXT_BY_MIME[audioMime] || 'webm';
      const audioFilename = `recording-${recordedAt}.${audioExt}`;

      const audioBlob = new Blob(audioChunksRef.current, { type: audioMime });
      const formData = new FormData();

      // Large-file path: upload the audio DIRECTLY to GCS via a signed URL so it
      // never passes through Cloud Run (whose 32 MiB request-body cap blocks long
      // recordings, ~30+ min). If the signed-URL flow is unavailable (e.g. GCS
      // not configured in local dev), fall back to the through-server upload.
      let audioObjectName: string | null = null;
      try {
        const signRes = await fetch('/api/uploads/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: audioFilename, contentType: audioMime }),
        });
        if (signRes.ok) {
          const { uploadUrl, objectName, contentType } = await signRes.json();
          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': contentType || audioMime },
            body: audioBlob,
          });
          if (putRes.ok) audioObjectName = objectName;
        }
      } catch { /* fall back to through-server upload below */ }

      if (audioObjectName) {
        formData.append('audioObjectName', audioObjectName);
      } else {
        formData.append('audio', audioBlob, audioFilename);
      }
      attachmentItems.forEach(item => {
        formData.append('attachments', item.file, item.displayName || item.file.name);
      });
      if (attachmentItems.length > 0) {
        formData.append('attachmentsOcr', JSON.stringify(
          attachmentItems.map(item => ({ ocrText: item.ocrText || null }))
        ));
      }
      if (liveAttachments.length > 0) {
        formData.append('liveAttachments', JSON.stringify(liveAttachments));
      }

      // Post-recording transcription: send the ACTUAL audio to Gemini for an
      // accurate transcript. The live Web Speech text is unreliable (especially
      // on iOS, where it fights MediaRecorder for the mic), so it serves only the
      // live view and we replace it here. Falls back to the live text on failure.
      let finalText = text;
      let finalTimedLines = timedLines;
      try {
        let tr: Response;
        if (audioObjectName) {
          tr = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objectName: audioObjectName }),
          });
        } else {
          const tfd = new FormData();
          tfd.append('audio', audioBlob, audioFilename);
          tr = await fetch('/api/transcribe', { method: 'POST', body: tfd });
        }
        if (tr.ok) {
          const td = await tr.json();
          const raw = (td.rawText || '').trim();
          if (raw) {
            finalText = raw;
            // Gemini emits no timestamps: spread the speaker lines evenly across
            // the recording's approximate duration (last live marker) so the
            // timeline ordering stays correct even though times are approximate.
            const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
            const totalMs = timedLines.length ? timedLines[timedLines.length - 1].ms : 0;
            finalTimedLines = lines.map((l: string, i: number) => ({
              ms: lines.length > 1 ? Math.round((i / (lines.length - 1)) * totalMs) : 0,
              text: l,
            }));
          }
        }
      } catch { /* keep live Web Speech text as fallback */ }

      formData.append('text', finalText);

      const uploadRes = await fetch('/api/recordings', { method: 'POST', body: formData });
      const uploadResText = await uploadRes.text();
      let uploadedData: any;
      try { uploadedData = JSON.parse(uploadResText); } catch (_) { uploadedData = null; }
      if (!uploadRes.ok || !uploadedData) throw new Error(`Upload failed: ${uploadResText.slice(0, 200)}`);

      // Internal participants' Kintone login names (= tax-brain emails)
      const participantEmails = participantsList
        .filter(p => TAX_BRAIN_MEMBERS.includes(p))
        .map(p => getEmailByName(p))
        .filter((e): e is string => !!e);

      // Fetch Gemini result from the live session if available
      let geminiResult: string | undefined;
      const sid = sessionIdRef.current;
      if (sid) {
        try {
          const sessionSnap = await getDoc(doc(db, 'liveSessions', sid));
          if (sessionSnap.exists()) {
            const sd = sessionSnap.data();
            if (sd.geminiResult) geminiResult = sd.geminiResult;
          }
        } catch { /* non-fatal */ }
      }

      let docRef: any;
      try {
        docRef = await addDoc(collection(db, 'recordings'), {
          title,
          text: finalText,
          formattedText: uploadedData.formattedText || null,
          timedLines: finalTimedLines,
          audioUrl: uploadedData.audioUrl,
          createdAt: recordedAt,
          kintoneSynced: false,
          userId: auth.currentUser.uid,
          customerNumber: selectedCustomer?.number || '',
          customerName: selectedCustomer?.name || '',
          customerSubmitNo: selectedCustomer?.submitNo || '',
          participants: participantsList,
          participantEmails,
          attachments: uploadedData.attachments || [],
          ...(geminiResult ? { geminiResult } : {}),
        });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.CREATE, 'recordings');
        throw firestoreErr;
      }

      let syncResult: { summary: string; recordUrl: string | null } | null = null;
      try {
        const settings = await getKintoneSettings();
        if (settings.domain && settings.appId && settings.apiToken) {
          const userEmail = auth.currentUser?.email || '';
          const promptSettings = await loadUserPromptSettings(userEmail);
          const extraInstruction = buildExtraInstruction(promptSettings);
          const kintoneRes = await fetch('/api/kintone/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...settings,
              id: docRef.id,
              title,
              text: finalText,
              formattedText: uploadedData.formattedText || null,
              timedLines: finalTimedLines,
              audioUrl: uploadedData.audioUrl,
              createdAt: recordedAt,
              customerNumber: selectedCustomer?.number || '',
              customerName: selectedCustomer?.name || '',
              customerSubmitNo: selectedCustomer?.submitNo || '',
              participants: participantsList,
              participantEmails,
              attachments: uploadedData.attachments || [],
              userDisplayName: auth.currentUser?.displayName || '',
              appOrigin: window.location.origin,
              extraInstruction: extraInstruction || undefined,
            })
          });
          if (kintoneRes.ok) {
            const kintoneData = await kintoneRes.json();
            await updateDoc(doc(db, 'recordings', docRef.id), {
              kintoneSynced: true,
              summary: kintoneData.summary || '',
              kintoneRecordUrl: kintoneData.recordUrl || '',
              kintoneRecordId: kintoneData.recordId ? String(kintoneData.recordId) : '',
            });
            syncResult = {
              summary: kintoneData.summary || '',
              recordUrl: kintoneData.recordUrl || null,
            };
          }
        }
      } catch (kintoneErr: any) {
        console.warn('[Auto Kintone] failed (non-fatal):', kintoneErr.message);
      }

      setAttachmentItems([]);
      setLiveAttachments([]);
      setExpandedOcr(new Set());
      resetRecording();
      // If the CRM sync succeeded, surface a completion popup (the user closes it
      // to return to the dashboard). Otherwise navigate straight to the dashboard.
      if (syncResult) {
        setSyncSuccess(syncResult);
      } else {
        onViewChange('dashboard');
      }
    } catch (e: any) {
      console.error(e);
      setSaveError(`保存に失敗しました: ${e?.message || 'Unknown error'} — ネットワークを確認して再試行してください。`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col space-y-4 mt-4 pb-36">
      <ScrollToTop />
      {/* Browser-wide drag overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-blue-600/20 border-4 border-blue-500 border-dashed flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-slate-800 rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3">
            <Paperclip className="w-10 h-10 text-blue-600" />
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">ここにドロップしてアップロード</p>
            <p className="text-sm text-slate-400">複数ファイルも同時にドロップできます</p>
          </div>
        </div>
      )}

      {/* Recording control — top center, wide horizontal bar */}
      <div className="w-full bg-slate-900 dark:bg-slate-950 rounded-xl px-5 py-4 shadow-lg text-white flex flex-col md:flex-row md:items-center gap-4">

        {/* Session ID block (left) — compact styling matching LiveView */}
        {sessionId && (
          <div className="md:border-r md:border-slate-700 md:pr-5 shrink-0 flex items-baseline gap-2 justify-center md:justify-start">
            <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">セッションID（ライブ同期用）</span>
            <span className="text-xl tabular-nums font-bold tracking-[0.15em] text-white">{sessionId}</span>
          </div>
        )}

        {/* Status / meter (center, grows) */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1 min-w-0">
          {isRecording ? (
            <>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-red-400 text-sm font-bold shrink-0">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <span>録音中</span>
                  <span className="text-red-300 text-base tabular-nums">
                    {String(Math.floor(recordingDuration / 3600)).padStart(2, '0')}:{String(Math.floor((recordingDuration % 3600) / 60)).padStart(2, '0')}:{String(recordingDuration % 60).padStart(2, '0')}
                  </span>
                </div>
                <AudioLevelMeter stream={mediaStreamRef.current} />
              </div>
              {micLabel && (
                <p className="text-[10px] text-slate-400 truncate max-w-full flex items-center gap-1">
                  <Mic className="w-3 h-3 shrink-0" />
                  <span className="truncate">{micLabel}</span>
                </p>
              )}
            </>
          ) : (
            !sessionId && (
              <p className="text-slate-300 text-xs text-center leading-relaxed hidden md:block">
                録音を開始すると、別端末の「ライブ同期」タブでセッションIDを入力して<br />
                文字起こしの確認・顧客情報の入力ができます
              </p>
            )
          )}
        </div>

        {/* Action button (right) */}
        <div className="shrink-0 w-full md:w-auto">
          {!isRecording ? (
            (isSaving || hasAudio) ? (
              <div className="w-full md:w-auto flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-blue-900/40 border border-blue-700">
                <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
                <span className="text-blue-200 font-bold whitespace-nowrap">保存・CRM送信中...</span>
              </div>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={isStarting}
                className="w-full md:w-auto flex items-center justify-center gap-3 bg-red-500 hover:bg-red-400 disabled:bg-red-800 disabled:opacity-60 active:scale-95 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-xl transition-all duration-150 border-2 border-red-400"
              >
                {isStarting
                  ? <><Loader2 className="w-6 h-6 animate-spin" />準備中...</>
                  : <><CircleDot className="w-6 h-6" />録音を開始する</>
                }
              </button>
            )
          ) : (
            <button
              onClick={handleStopRecording}
              className="w-full md:w-auto flex items-center justify-center gap-3 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-xl transition-all duration-150 border-2 border-slate-600"
            >
              <Square className="w-6 h-6" fill="currentColor" />
              録音を停止する
            </button>
          )}
        </div>
      </div>

      {/* Silence warning banner */}
      {silenceWarning && isRecording && (
        <div className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">10秒以上、音声が検出されていません</p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">画面ロック等でマイクが切断された可能性があります</p>
          </div>
          <button
            type="button"
            onClick={handleReconnect}
            className="shrink-0 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            再接続
          </button>
        </div>
      )}

      {/* Main 2-column: left=controls, right=transcript */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-4 items-start">

      {/* LEFT COLUMN: controls */}
      <div className="flex flex-col gap-4">

      {/* 1. Kintone Customer Lookup */}
      <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-600" />
              CRM顧客DBルックアップ
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
                    <span className="text-blue-600 dark:text-slate-100 mr-2">{selectedCustomer.number}</span>
                  )}
                  {selectedCustomer.name}
                </p>
              </div>
              <button type="button" onClick={() => { setSelectedCustomer(null); syncSessionUpdate({ customerName: '', customerNumber: '', customerSubmitNo: '' }); }} className="p-1.5 text-slate-400 hover:text-red-500 rounded-full transition-colors active:scale-95 duration-150">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <input
                  ref={customerInputRef}
                  type="text"
                  placeholder="顧問先名・番号で検索、または顧客名を直接入力..."
                  value={customerKeyword}
                  onChange={(e) => setCustomerKeyword(e.target.value)}
                  onKeyDown={handleCustomerInputKeyDown}
                  className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 pl-3 pr-10 py-3 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isSearchingCustomers
                    ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    : <Search className="w-4 h-4 text-slate-400" />
                  }
                </div>
              </div>
              {lookupError && <p className="text-xs text-red-500 font-medium">{lookupError}</p>}
              {/* Free-text entry: use whatever the user typed directly as the
                  customer name, even if it isn't in the CRM lookup results. */}
              {customerKeyword.trim() && !isSearchingCustomers && (
                <button
                  type="button"
                  onClick={() => {
                    const name = customerKeyword.trim();
                    const c = { name, number: '', submitNo: '' };
                    setSelectedCustomer(c);
                    setCustomers([]);
                    setCustomerKeyword('');
                    syncSessionUpdate({ customerName: name, customerNumber: '', customerSubmitNo: '' });
                  }}
                  className="w-full text-left px-4 py-2.5 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors active:scale-[0.99] duration-150 flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span className="truncate">「{customerKeyword.trim()}」をそのまま顧客名として使用</span>
                </button>
              )}
              {customers.length > 0 && (
                <div
                  ref={customerListRef}
                  className="border border-slate-200 dark:border-slate-600 rounded-lg max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 bg-slate-100 dark:bg-slate-950 shadow-lg"
                >
                  {customers.map((c, i) => (
                    <button
                      key={c.id || c.number || c.name}
                      type="button"
                      onClick={() => { setSelectedCustomer(c); setCustomers([]); setCustomerKeyword(''); syncSessionUpdate({ customerName: c.name, customerNumber: c.number || '', customerSubmitNo: c.submitNo || '' }); }}
                      onKeyDown={(e) => handleCustomerListKeyDown(e, i)}
                      className="w-full text-left px-4 py-3 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors active:scale-[0.99] duration-150"
                    >
                      <span className="font-bold text-sm text-blue-600 dark:text-slate-100 mr-2">{c.number}</span>
                      <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{c.name || '名称未設定'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      {/* 2. Participants */}
      <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
          {(() => {
            const internal = participantsList.filter(p => TAX_BRAIN_MEMBERS.includes(p) || p === selfName);
            const external = participantsList.filter(p => !TAX_BRAIN_MEMBERS.includes(p) && p !== selfName);
            return (
              <>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  今回の参加者の氏名
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    <span className="text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full border border-blue-100 dark:border-blue-800 whitespace-nowrap">社内 {internal.length}名</span>
                    <span className="text-xs font-bold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full border border-amber-100 dark:border-amber-800 whitespace-nowrap">社外 {external.length}名</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${participantsList.length > 0 ? 'bg-slate-700 dark:bg-slate-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>計 {participantsList.length}名</span>
                  </span>
                </h3>

                {/* Tax Brain member selection (click-select + word/furigana filter) */}
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
                            className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {TAX_BRAIN_MEMBERS.filter(m => memberMatchesQuery(m, memberQuery)).map((member) => {
                          const selected = participantsList.includes(member);
                          const isSelf = member === selfName;
                          return (
                            <button
                              key={member}
                              type="button"
                              onClick={() => toggleMember(member)}
                              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors border-b border-slate-100 dark:border-slate-700 last:border-b-0 active:scale-[0.99] duration-150 ${selected ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-slate-100' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                            >
                              <span className="font-medium">{member}{isSelf ? ' (自分)' : ''}</span>
                              {selected && <Check className="w-4 h-4 text-blue-600 dark:text-white" />}
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

                {/* External participant input */}
                <form onSubmit={addExternalParticipant} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="社外参加者の氏名を入力..."
                    value={participantInput}
                    onChange={(e) => setParticipantInput(e.target.value)}
                    className="flex-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
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
                        className="flex items-center bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-slate-100 border border-blue-100 dark:border-blue-800 rounded-md px-2 py-1 text-[11px] font-semibold"
                      >
                        <span>{p}{p === selfName ? ' (自分)' : ''}</span>
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

      {/* 3. Attachment */}
      <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-2">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-blue-600" />
            添付資料（AI解析・CRM保存用）
            {(attachmentItems.length + liveAttachments.length) > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full border border-blue-100 dark:border-blue-800">
                {attachmentItems.length + liveAttachments.length}件
              </span>
            )}
          </h3>

          {/* Local attachment list with OCR accordion */}
          {attachmentItems.length > 0 && (
            <div className="space-y-1.5">
              {attachmentItems.map(item => (
                <div key={item.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden text-sm">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-700">
                    <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                    {editingAttId === item.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingAttName}
                        onChange={e => setEditingAttName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveAttachmentName(item.id, editingAttName);
                          if (e.key === 'Escape') setEditingAttId(null);
                        }}
                        onBlur={() => saveAttachmentName(item.id, editingAttName)}
                        className="flex-1 min-w-0 px-2 py-0.5 text-sm border border-blue-400 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        title="プレビュー"
                        onClick={() => openPreviewFile(item)}
                        className="flex-1 truncate font-medium text-blue-600 dark:text-blue-400 hover:underline text-left"
                      >{item.displayName}</button>
                    )}
                    {editingAttId !== item.id && (
                      <>
                        <button
                          type="button"
                          title="ダウンロード"
                          onClick={() => downloadFileItem(item)}
                          className="p-0.5 text-slate-400 hover:text-blue-500 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {!item.ocrLoading && editingAttId !== item.id && (
                      <>
                        <button
                          type="button"
                          title="ファイル名を編集"
                          onClick={() => { setEditingAttId(item.id); setEditingAttName(item.displayName); }}
                          className="p-0.5 text-slate-400 hover:text-blue-500 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="AIでファイル名をリネーム"
                          onClick={() => aiRenameAttachment(item)}
                          disabled={item.aiRenaming}
                          className="p-0.5 text-slate-400 hover:text-purple-500 disabled:opacity-40 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          {item.aiRenaming
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Wand2 className="w-4 h-4" />
                          }
                        </button>
                      </>
                    )}
                    {item.ocrLoading ? (
                      <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                    ) : item.ocrText ? (
                      <button
                        type="button"
                        onClick={() => setExpandedOcr(prev => {
                          const next = new Set(prev);
                          next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                          return next;
                        })}
                        className="text-xs text-blue-600 dark:text-blue-400 font-bold px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0 flex items-center gap-0.5"
                      >
                        OCR <ChevronDown className={`w-3 h-3 transition-transform ${expandedOcr.has(item.id) ? 'rotate-180' : ''}`} />
                      </button>
                    ) : item.ocrError ? (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">—</span>
                    ) : null}
                    <span className="text-[10px] text-slate-400 shrink-0">{(item.file.size / 1024).toFixed(0)}KB</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = attachmentItemsRef.current.filter(a => a.id !== item.id);
                        setAttachmentItems(next);
                        syncRecorderAttachments(next);
                        setExpandedOcr(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                        if (editingAttId === item.id) setEditingAttId(null);
                      }}
                      className="p-0.5 text-red-400 hover:text-red-600 transition-colors active:scale-90 duration-150 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {expandedOcr.has(item.id) && item.ocrText && (
                    <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-600 max-h-40 overflow-y-auto bg-white dark:bg-slate-800">
                      <pre className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{item.ocrText}</pre>
                    </div>
                  )}
                  {item.ocrError && (
                    <div className="px-3 py-1.5 border-t border-amber-100 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">{item.ocrError}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* LiveView attachments with delete */}
          {liveAttachments.length > 0 && (
            <div className="space-y-1.5 pb-1">
              <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">ライブ同期から共有</p>
              {liveAttachments.map((att, i) => (
                <div key={i} className="border border-emerald-200 dark:border-emerald-800 rounded-lg overflow-hidden text-sm">
                  <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20">
                    <Paperclip className="w-4 h-4 text-emerald-500 shrink-0" />
                    {editingLiveUrl === att.url ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingLiveName}
                        onChange={e => setEditingLiveName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renameLiveAttachment(att.url, editingLiveName);
                          if (e.key === 'Escape') setEditingLiveUrl(null);
                        }}
                        onBlur={() => renameLiveAttachment(att.url, editingLiveName)}
                        className="flex-1 min-w-0 px-2 py-0.5 text-sm border border-emerald-400 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        title="プレビュー"
                        onClick={() => openPreviewAtt(att)}
                        className="flex-1 truncate font-medium text-emerald-600 dark:text-emerald-400 hover:underline text-left"
                      >{att.name}</button>
                    )}
                    {editingLiveUrl !== att.url && (
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
                          onClick={() => { setEditingLiveUrl(att.url); setEditingLiveName(att.name); }}
                          className="p-0.5 text-slate-400 hover:text-emerald-600 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="AIでファイル名をリネーム"
                          onClick={() => aiRenameLiveAttachment(att)}
                          disabled={aiRenamingLiveUrls.has(att.url)}
                          className="p-0.5 text-slate-400 hover:text-purple-500 disabled:opacity-40 transition-colors active:scale-90 duration-150 shrink-0"
                        >
                          {aiRenamingLiveUrls.has(att.url) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
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

          {/* Add files button */}
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg py-3 text-sm text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors active:scale-[0.99] duration-150"
          >
            <Paperclip className="w-4 h-4" />
            ファイルを追加（ブラウザにドロップでも可）
          </button>
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files: File[] = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) addFiles(files);
              e.target.value = '';
            }}
          />
          {(attachmentItems.length + liveAttachments.length) > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">CRM送信時にAI要約の参考資料として使用し、CRMの添付ファイルに保存されます。</p>
          )}
      </div>

          </div>{/* end left column */}

          {/* RIGHT COLUMN: transcript */}
      <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">文字起こし</h2>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
              <button type="button" onClick={() => setFeedTab('tl')}
                className={`px-4 py-1.5 text-xs font-bold transition-colors ${feedTab === 'tl' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                TL
              </button>
              <button type="button" onClick={() => setFeedTab('raw')}
                className={`px-4 py-1.5 text-xs font-bold transition-colors border-l border-slate-200 dark:border-slate-600 ${feedTab === 'raw' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                原文
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRecording && (
              <span className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-widest flex items-center">
                <span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>Live
              </span>
            )}
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
        <div className="bg-white dark:bg-slate-800 p-6 min-h-[180px] max-h-[55vh] overflow-y-auto">
          {feedTab === 'tl' ? (
            timedLines.length > 0 ? (
              <div className="space-y-2.5">
                {timedLines.map((line, i) => (
                  <div key={i} className="flex gap-2.5 items-start text-sm">
                    <span className="text-[11px] text-blue-500 dark:text-blue-400 shrink-0 mt-0.5 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded tabular-nums">
                      {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{line.text}</span>
                  </div>
                ))}
                {isRecording && (
                  <div className="flex gap-2.5 items-center">
                    <span className="text-[11px] text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded w-[3.5rem] text-center">…</span>
                    <TypingDots />
                  </div>
                )}
              </div>
            ) : isRecording ? (
              <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
            ) : (
              <p className="text-slate-400 italic text-center mt-8 text-sm">ここに文字起こしデータが表示されます。</p>
            )
          ) : (
            text ? (
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{text}</p>
            ) : isRecording ? (
              <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
            ) : (
              <p className="text-slate-400 italic text-center mt-8 text-sm">ここに文字起こしデータが表示されます。</p>
            )
          )}
        </div>
      </div>

          </div>{/* end 2-column grid */}

      {/* Transcript fullscreen overlay */}
      {transcriptFullscreen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setTranscriptFullscreen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-[1344px] max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">文字起こし</h2>
                <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
                  <button type="button" onClick={() => setFeedTab('tl')}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors ${feedTab === 'tl' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
                    TL
                  </button>
                  <button type="button" onClick={() => setFeedTab('raw')}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors border-l border-slate-200 dark:border-slate-600 ${feedTab === 'raw' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>
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
              {feedTab === 'tl' ? (
                timedLines.length > 0 ? (
                  <div className="space-y-2.5">
                    {timedLines.map((line, i) => (
                      <div key={i} className="flex gap-2.5 items-start text-sm">
                        <span className="text-[11px] text-blue-500 dark:text-blue-400 shrink-0 mt-0.5 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded tabular-nums">
                          {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
                        </span>
                        <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{line.text}</span>
                      </div>
                    ))}
                    {isRecording && (
                      <div className="flex gap-2.5 items-center">
                        <span className="text-[11px] text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded w-[3.5rem] text-center">…</span>
                        <TypingDots />
                      </div>
                    )}
                  </div>
                ) : isRecording ? (
                  <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
                ) : (
                  <p className="text-slate-400 italic text-center mt-8 text-sm">ここに文字起こしデータが表示されます。</p>
                )
              ) : (
                text ? (
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{text}</p>
                ) : isRecording ? (
                  <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
                ) : (
                  <p className="text-slate-400 italic text-center mt-8 text-sm">ここに文字起こしデータが表示されます。</p>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gemini Assistant */}
      <GeminiAssistant
        liveText={isRecording && text ? text : null}
        triggerWord={triggerWord}
        sessionId={sessionId || undefined}
        customerNumber={selectedCustomer?.number}
      />

      {/* Save error + retry */}
      {saveError && (
        <div className="w-full max-w-3xl mx-auto space-y-2">
          <p className="text-red-600 dark:text-red-400 text-sm font-bold text-center">{saveError}</p>
          <button
            onClick={saveRecording}
            disabled={isSaving}
            className="w-full flex items-center justify-center py-4 px-6 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-60 text-white rounded-xl shadow-sm transition-all duration-150 text-base font-bold"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
            再試行して保存する
          </button>
        </div>
      )}

      {/* CRM sync success popup */}
      {syncSuccess && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => { setSyncSuccess(null); onViewChange('dashboard'); }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">CRM へ API 送信できました</p>
              {syncSuccess.summary && (
                <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto w-full">
                  {syncSuccess.summary}
                </p>
              )}
              {/* Intended navigation to the CRM record. recordUrl is null in the
                  demo, so the link is present but clearly non-functional. */}
              {syncSuccess.recordUrl ? (
                <a
                  href={syncSuccess.recordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold py-3 px-6 rounded-xl transition-all duration-150"
                >
                  CRM で開く
                </a>
              ) : (
                <div className="w-full flex flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled
                    title="デモ環境では遷移しません"
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-6 rounded-xl opacity-50 cursor-not-allowed"
                  >
                    CRM で開く
                  </button>
                  <span className="text-[11px] text-slate-400">デモ環境では遷移しません</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => { setSyncSuccess(null); onViewChange('dashboard'); }}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 px-6 rounded-xl transition-colors active:scale-95 duration-150"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <AttachmentPreviewModal url={preview.url} name={preview.name} onClose={closePreview} />
      )}
    </div>
  );
}
