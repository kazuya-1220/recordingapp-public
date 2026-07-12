import React, { useState, useRef, useCallback } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { ViewState } from '../App';
import { Mic2, StopCircle, Loader2, Save, RotateCcw, FlaskConical, Mic } from 'lucide-react';

type Phase = 'idle' | 'recording' | 'transcribing' | 'review';

interface TranscriptLine {
  speaker: string;
  text: string;
}

const SPEAKER_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-700',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-700',
];

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export function VoiceprintRecorder({ onViewChange, user }: { onViewChange: (view: ViewState) => void; user: FirebaseUser }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [rawText, setRawText] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const mimeType = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeAudio(blob, mimeType);
      };

      mr.start(1000);
      setPhase('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (e: any) {
      setError(`マイクへのアクセスに失敗しました: ${e.message}`);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setPhase('transcribing');
  }, []);

  const transcribeAudio = async (blob: Blob, mimeType: string) => {
    setError(null);
    try {
      const formData = new FormData();
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      formData.append('audio', blob, `recording.${ext}`);

      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`サーバーエラー (${res.status}): ${body.slice(0, 100)}`);
      }
      const data = await res.json();

      setTranscript(data.transcript || []);
      setRawText(data.rawText || '');
      setAudioUrl(data.audioUrl || null);
      setTitle(`録音: ${new Date().toLocaleString('ja-JP')}`);
      setPhase('review');
    } catch (e: any) {
      setError(`文字起こしに失敗しました: ${e.message}`);
      setPhase('idle');
    }
  };

  const reset = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    setPhase('idle');
    setElapsed(0);
    setTranscript([]);
    setRawText('');
    setAudioUrl(null);
    setTitle('');
    setError(null);
  };

  const saveRecording = async () => {
    if (!auth.currentUser) return;
    setIsSaving(true);
    setError(null);
    try {
      const speakers = [...new Set(transcript.map(l => l.speaker))];
      await addDoc(collection(db, 'recordings'), {
        title: title.trim() || `録音: ${new Date().toLocaleString('ja-JP')}`,
        text: rawText,
        audioUrl,
        createdAt: Date.now(),
        kintoneSynced: false,
        userId: auth.currentUser.uid,
        customerNumber: '',
        customerName: '',
        participants: speakers,
        attachments: [],
        transcriptLines: transcript,
      });
      onViewChange('dashboard');
    } catch (e: any) {
      handleFirestoreError(e, OperationType.CREATE, 'recordings');
      setError(`保存に失敗しました: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Map speaker names to consistent color indices
  const speakerColorMap: Record<string, number> = {};
  let nextColorIdx = 0;
  transcript.forEach(l => {
    if (!(l.speaker in speakerColorMap)) speakerColorMap[l.speaker] = nextColorIdx++ % SPEAKER_COLORS.length;
  });

  return (
    <div className="flex flex-col space-y-4 mt-4 pb-36">
      {/* Header */}
      <div className="w-full bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-800 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white">
          <div className="flex items-center gap-3 mb-2">
            <Mic2 className="w-6 h-6" />
            <h2 className="text-lg font-bold">話者分離録音</h2>
            <span className="flex items-center gap-1 bg-white/20 border border-white/30 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              <FlaskConical className="w-3 h-3" />Beta
            </span>
          </div>
          <p className="text-purple-100 text-sm leading-relaxed">
            Gemini AIが録音を解析し、話者ごとにラベル付きで文字起こしします。
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Main control area */}
      {(phase === 'idle' || phase === 'recording') && (
        <div className="w-full bg-slate-900 dark:bg-slate-950 rounded-xl p-6 text-white flex flex-col items-center gap-5">
          {/* Timer */}
          <div className="text-4xl font-mono font-bold tracking-widest text-slate-200">
            {formatTime(elapsed)}
          </div>

          {/* Pulse animation while recording */}
          {phase === 'recording' && (
            <div className="flex items-center gap-2 text-red-400 text-sm font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              録音中
            </div>
          )}

          {/* Record / Stop button */}
          {phase === 'idle' ? (
            <button
              onClick={startRecording}
              className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-lg py-5 rounded-xl transition-all"
            >
              <Mic className="w-6 h-6" />
              録音を開始する
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="w-full flex items-center justify-center gap-3 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-lg py-5 rounded-xl transition-all"
            >
              <StopCircle className="w-6 h-6" />
              録音を停止して解析
            </button>
          )}
        </div>
      )}

      {/* Transcribing state */}
      {phase === 'transcribing' && (
        <div className="w-full bg-slate-900 dark:bg-slate-950 rounded-xl p-8 text-white flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
          <p className="text-slate-300 font-medium">AIが音声を解析しています…</p>
          <p className="text-slate-500 text-sm">話者ごとに文字起こし中（{formatTime(elapsed)} 録音分）</p>
        </div>
      )}

      {/* Review state */}
      {phase === 'review' && (
        <>
          {/* Title input */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Transcript */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">文字起こし結果</h3>
              {Object.keys(speakerColorMap).length > 0 && (
                <span className="text-xs text-slate-400">{Object.keys(speakerColorMap).length}名の話者を検出</span>
              )}
            </div>
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {transcript.length > 0 ? transcript.map((line, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border ${SPEAKER_COLORS[speakerColorMap[line.speaker] ?? 0]}`}>
                    {line.speaker}
                  </span>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{line.text}</p>
                </div>
              )) : (
                <pre className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">{rawText || '（文字起こし結果が取得できませんでした）'}</pre>
              )}
            </div>
          </div>

          {/* Audio player */}
          {audioUrl && (
            <div className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">録音音声</p>
              <audio controls src={audioUrl} className="w-full h-10" />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 w-full">
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              やり直す
            </button>
            <button
              onClick={saveRecording}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm transition-colors"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSaving ? '保存中...' : '保存する'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
