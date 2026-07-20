import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { TimedLine } from '../types';

interface RecordingContextType {
  isRecording: boolean;
  text: string;
  timedLines: TimedLine[];
  sessionId: string;
  hasAudio: boolean;
  audioChunksRef: React.MutableRefObject<Blob[]>;
  audioMimeTypeRef: React.MutableRefObject<string>;
  mediaStreamRef: React.MutableRefObject<MediaStream | null>;
  startRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
}

const RecordingContext = createContext<RecordingContextType>(null!);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [text, setText] = useState('');
  const [timedLines, setTimedLines] = useState<TimedLine[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [hasAudio, setHasAudio] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Actual container/codec MediaRecorder produced (iOS Safari yields audio/mp4,
  // Chrome yields audio/webm). Recorded so the saved file gets the correct
  // extension + Content-Type — otherwise iOS mp4 saved as .webm won't play back.
  const audioMimeTypeRef = useRef<string>('audio/webm');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef('');
  const wakeLockRef = useRef<any>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const timedLinesRef = useRef<TimedLine[]>([]);
  const lastLineTimeRef = useRef<number>(0);

  const updateLiveTranscription = async (
    sid: string, newText: string, isFinal: boolean, lines: TimedLine[] = []
  ) => {
    if (!sid) return;
    try {
      await setDoc(doc(db, 'liveSessions', sid), {
        text: newText,
        isFinal,
        updatedAt: Date.now(),
        sessionId: sid,
        timedLines: lines,
      }, { merge: true });
    } catch (e) {
      console.error('Live sync error:', e);
    }
  };

  const acquireWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('[WakeLock] acquired');
      }
    } catch (e) {
      console.warn('[WakeLock] unavailable:', e);
    }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  const startMediaCapture = async (sid: string, retryCount = 0): Promise<boolean> => {
    // Null ref first so the old recognition's onend won't restart itself
    const oldRecognition = recognitionRef.current;
    recognitionRef.current = null;
    if (oldRecognition) { try { oldRecognition.stop(); } catch (_) {} }

    // Stop existing MediaRecorder without triggering auto-save (reconnect scenario)
    if (mediaRecorderRef.current) {
      const old = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      old.onstop = null; // Suppress hasAudio trigger
      if (old.state !== 'inactive') { try { old.stop(); } catch (_) {} }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      mediaStreamRef.current = null;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        }
      });
      mediaStreamRef.current = stream;
    } catch (err: any) {
      const isTransient = err?.name === 'NotReadableError' || err?.name === 'AbortError';
      if (isTransient && retryCount < 2) {
        console.warn(`[Mic] ${err.name} — retrying in ${(retryCount + 1) * 600}ms (attempt ${retryCount + 1}/2)`);
        await new Promise(r => setTimeout(r, (retryCount + 1) * 600));
        return startMediaCapture(sid, retryCount + 1);
      }
      console.error('Microphone access error:', err);
      if (err?.name !== 'AbortError') {
        alert('マイクへのアクセスが拒否されました。ブラウザの設定でマイクを許可してください。');
      }
      return false;
    }

    // NOTE: recordingStartTimeRef is set in startRecording only (not reset on resume)

    try {
      // Pick a container MediaRecorder actually supports on this browser.
      // iOS Safari rejects webm and falls back to mp4; Chrome prefers webm/opus.
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mt = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported
        ? preferred.find(c => MediaRecorder.isTypeSupported(c)) || ''
        : '';
      const mediaRecorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      // Record the type the browser really chose (may differ from `mt`).
      audioMimeTypeRef.current = (mediaRecorder.mimeType || mt || 'audio/webm').split(';')[0];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        setHasAudio(true);
      };

      mediaRecorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = 'ja-JP';

        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          if (finalTranscript) {
            const now = Date.now();
            const ms = now - recordingStartTimeRef.current;
            const elapsed = now - lastLineTimeRef.current;
            const MIN_GAP = 15000; // merge utterances within 15s into one TL entry
            if (timedLinesRef.current.length === 0 || elapsed >= MIN_GAP) {
              timedLinesRef.current = [...timedLinesRef.current, { ms, text: finalTranscript }];
              lastLineTimeRef.current = now;
            } else {
              const last = timedLinesRef.current[timedLinesRef.current.length - 1];
              timedLinesRef.current = [...timedLinesRef.current.slice(0, -1), { ...last, text: last.text + '　' + finalTranscript }];
            }
            setTimedLines([...timedLinesRef.current]);
          }
          setText(prev => {
            const newText = prev + finalTranscript;
            updateLiveTranscription(sid, newText + interimTranscript, !!finalTranscript, timedLinesRef.current);
            return newText;
          });
        };

        recognition.onerror = (event: any) => {
          console.warn('SpeechRecognition error:', event.error);
        };

        // Only restart if this recognition is still the active one
        recognition.onend = () => {
          if (recognitionRef.current === recognition && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            setTimeout(() => {
              try { recognition.start(); } catch (_) {}
            }, 250);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      }
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('録音の開始に失敗しました。マイクの設定を確認してください。');
      return false;
    }
  };

  // Auto-resume when screen unlocks on iOS (visibilitychange fires on unlock)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !isRecordingRef.current) return;
      const sid = sessionIdRef.current;
      if (!sid) return;

      acquireWakeLock();

      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
        // MediaRecorder was killed — restart without resetting the start timestamp
        // Delay 400ms: iOS needs time to restore hardware mic access after unlock
        setHasAudio(false);
        setTimeout(() => { if (isRecordingRef.current) startMediaCapture(sid); }, 400);
      } else if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch (_) {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const startRecording = useCallback(async () => {
    const newId = Math.floor(1000 + Math.random() * 9000).toString();

    sessionIdRef.current = newId;
    setSessionId(newId);
    setText('');
    setTimedLines([]);
    timedLinesRef.current = [];
    lastLineTimeRef.current = 0;
    setHasAudio(false);
    audioChunksRef.current = [];
    recordingStartTimeRef.current = Date.now(); // Set once per session

    setDoc(doc(db, 'liveSessions', newId), {
      text: '', updatedAt: Date.now(), sessionId: newId,
      customerName: '', customerNumber: '', participants: []
    }).catch(e => handleFirestoreError(e, OperationType.WRITE, `liveSessions/${newId}`));

    await acquireWakeLock();
    await startMediaCapture(newId);
  }, []);

  const resumeRecording = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setHasAudio(false);
    await acquireWakeLock();
    await startMediaCapture(sid);
  }, []);

  const stopRecording = useCallback(() => {
    releaseWakeLock();
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      } catch (_) {}
    }
    // Null ref first so onend won't trigger auto-restart
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) { try { rec.stop(); } catch (_) {} }
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    setIsRecording(false);
    isRecordingRef.current = false;
  }, []);

  const resetRecording = useCallback(() => {
    setText('');
    setTimedLines([]);
    timedLinesRef.current = [];
    lastLineTimeRef.current = 0;
    setSessionId('');
    sessionIdRef.current = '';
    setHasAudio(false);
    audioChunksRef.current = [];
  }, []);

  return (
    <RecordingContext.Provider value={{
      isRecording, text, timedLines, sessionId, hasAudio, audioChunksRef, audioMimeTypeRef, mediaStreamRef,
      startRecording, resumeRecording, stopRecording, resetRecording, setText
    }}>
      {children}
    </RecordingContext.Provider>
  );
}

export const useRecording = () => useContext(RecordingContext);
