import React, { useState, useRef, useEffect } from 'react';
import { collection, doc, setDoc, addDoc, getDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { Mic, Square, Loader2, Save, Users, UserPlus, X, User } from 'lucide-react';

export function Recorder({ onViewChange }: { onViewChange: (view: ViewState) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  // 面談の基本情報（任意・手入力）
  const [customerName, setCustomerName] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');

  const [participantInput, setParticipantInput] = useState('');
  const [participantsList, setParticipantsList] = useState<string[]>([]);

  useEffect(() => {
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    setSessionId(id);

    // ライブセッションの初期状態
    const initSession = async () => {
      try {
        await setDoc(doc(db, 'liveSessions', id), {
          text: '',
          updatedAt: Date.now(),
          sessionId: id
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, `liveSessions/${id}`);
      }
    };
    initSession();
  }, []);

  const addParticipant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = participantInput.trim();
    if (!name) return;
    if (participantsList.includes(name)) return;
    setParticipantsList([...participantsList, name]);
    setParticipantInput('');
  };

  const removeParticipant = (index: number) => {
    setParticipantsList(participantsList.filter((_, i) => i !== index));
  };

  const updateLiveTranscription = async (newText: string, isFinal: boolean) => {
    if (!sessionId) return;
    try {
      await setDoc(doc(db, 'liveSessions', sessionId), {
        text: newText,
        isFinal,
        updatedAt: Date.now(),
        sessionId
      }, { merge: true });
    } catch (e) {
      console.error("Live sync error:", e);
      handleFirestoreError(e, OperationType.WRITE, `liveSessions/${sessionId}`);
    }
  };

  const startRecording = async () => {
    try {
      setText('');
      setHasAudio(false);
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

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

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
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

          setText(prev => {
            const newText = prev + finalTranscript;
            const currentDisplay = newText + interimTranscript;
            updateLiveTranscription(currentDisplay, !!finalTranscript);
            return newText;
          });
        };

        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('マイクの設定を確認してください。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const buildTitle = () => {
    const name = customerName.trim();
    return name
      ? `記録: ${name}様 (${new Date().toLocaleDateString('ja-JP')})`
      : `記録: ${new Date().toLocaleString('ja-JP')}`;
  };

  const saveRecording = async () => {
    if (audioChunksRef.current.length === 0 || !auth.currentUser) return;
    setIsSaving(true);

    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, `recording-${Date.now()}.webm`);
      formData.append('title', buildTitle());
      formData.append('text', text);

      // 音声ファイルはサーバのローカルディスクへアップロード
      const uploadRes = await fetch('/api/recordings', {
        method: 'POST',
        body: formData,
      });

      const uploadResText = await uploadRes.text();
      let uploadedData: any;
      try {
        uploadedData = JSON.parse(uploadResText);
      } catch (jsonErr) {
        uploadedData = null;
      }

      if (!uploadRes.ok || !uploadedData) {
        throw new Error(`Failed to upload audio: ${uploadResText.slice(0, 500) || 'Unknown server error'}`);
      }

      // ライブセッションに保存された Gemini の調査結果があれば取得
      let geminiResult = '';
      try {
        const sessionDoc = await getDoc(doc(db, 'liveSessions', sessionId));
        geminiResult = sessionDoc.exists() ? (sessionDoc.data()?.geminiResult || '') : '';
      } catch (_) { /* ignore */ }

      // AI要約とセカンドアクションを生成
      let summary = '';
      try {
        const sumRes = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const sumData = await sumRes.json().catch(() => null);
        if (sumRes.ok && sumData) summary = sumData.summary || '';
      } catch (_) { /* 要約失敗は保存を止めない */ }

      // メタデータを Firestore に保存
      try {
        await addDoc(collection(db, 'recordings'), {
          title: buildTitle(),
          text: text,
          audioUrl: uploadedData.audioUrl,
          createdAt: Date.now(),
          userId: auth.currentUser.uid,
          customerNumber: customerNumber.trim(),
          customerName: customerName.trim(),
          participants: participantsList,
          summary,
          geminiResult,
        });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.CREATE, 'recordings');
      }

      onViewChange('dashboard');
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 mt-4 pb-20">

      <div className="bg-slate-900 rounded-xl p-6 shadow-lg text-white w-full sm:min-w-[400px] flex flex-col items-center">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Session ID (Live Sync)</h3>

        <div className="text-4xl font-mono text-white tracking-[0.5em] mb-8 bg-slate-800 px-8 py-4 rounded-lg border border-slate-700">
          {sessionId || '----'}
        </div>

        <div className="relative mb-6">
          {isRecording && (
            <div className="absolute -inset-4 bg-red-500/20 rounded-full animate-ping"></div>
          )}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`relative flex items-center justify-center w-20 h-20 rounded-xl text-white shadow-xl transition-all duration-300 ${
              isRecording ? 'bg-red-500 hover:bg-red-600 scale-95' : 'bg-blue-600 hover:bg-blue-500 hover:scale-105'
            }`}
          >
            {isRecording ? <Square className="w-8 h-8" fill="currentColor" /> : <Mic className="w-8 h-8" />}
          </button>
        </div>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {isRecording ? 'Recording Active...' : 'Tap to start over'}
        </p>
      </div>

      {/* 面談の基本情報（任意）と参加者 */}
      <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100">

        {/* 顧客情報（任意・手入力） */}
        <div className="p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight flex items-center">
            <User className="w-4.5 h-4.5 mr-2 text-blue-600" />
            面談相手の情報（任意）
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">顧客名 / 相手先</label>
              <input
                type="text"
                placeholder="例: 山田商事"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">整理番号（任意）</label>
              <input
                type="text"
                placeholder="例: 001"
                value={customerNumber}
                onChange={(e) => setCustomerNumber(e.target.value)}
                className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
              />
            </div>
          </div>
        </div>

        {/* 出席者入力フォーム */}
        <div className="p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight flex items-center">
            <Users className="w-4.5 h-4.5 mr-2 text-blue-600" />
            今回の参加者の氏名
          </h3>

          <form onSubmit={addParticipant} className="flex gap-2">
            <input
              type="text"
              placeholder="参加者の氏名を入力 (例: Ａ：私)"
              value={participantInput}
              onChange={(e) => setParticipantInput(e.target.value)}
              className="flex-1 border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors flex items-center shrink-0 border border-slate-200"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              追加
            </button>
          </form>

          {participantsList.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {participantsList.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center bg-blue-50 text-blue-700 border border-blue-100 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                >
                  <span>{p}</span>
                  <button
                    type="button"
                    onClick={() => removeParticipant(idx)}
                    className="ml-2 p-0.5 text-blue-400 hover:text-blue-600 transition-colors rounded-full hover:bg-blue-100/50"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">参加者はまだ追加されていません。</p>
          )}
        </div>

      </div>

      {/* Transcription Feed */}
      <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Transcription Feed</h2>
          {isRecording && <span className="text-[10px] text-red-600 font-bold uppercase tracking-widest flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>Live</span>}
        </div>
        <div className="bg-white p-6 min-h-[200px]">
          {text ? (
            <p className="text-slate-700 leading-relaxed font-sans">{text}</p>
          ) : (
            <p className="text-slate-400 italic text-center mt-10 text-sm">Transcription data will appear here.</p>
          )}
        </div>
      </div>

      {!isRecording && hasAudio && (
        <button
          onClick={saveRecording}
          disabled={isSaving}
          className="w-full flex items-center justify-center py-3 px-6 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 transition-colors text-sm font-medium cursor-pointer"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          録音を終了して保存する (Finish & Save Session)
        </button>
      )}

    </div>
  );
}
