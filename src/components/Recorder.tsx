import React, { useState, useRef, useEffect } from 'react';
import { collection, doc, setDoc, addDoc, getDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ViewState } from '../App';
import { Mic, Square, Loader2, Save, Search, Users, UserPlus, X, Check } from 'lucide-react';
import { getKintoneSettings } from '../lib/kintone';

export function Recorder({ onViewChange }: { onViewChange: (view: ViewState) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  // Kintone lookup & participants states
  const [kintoneConfig, setKintoneConfig] = useState<any>(null);
  const [customerKeyword, setCustomerKeyword] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [participantInput, setParticipantInput] = useState('');
  const [participantsList, setParticipantsList] = useState<string[]>([]);

  useEffect(() => {
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    setSessionId(id);

    // Initial state for live session
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

    // Load settings from helper
    async function loadConfig() {
      const config = await getKintoneSettings();
      setKintoneConfig(config);
    }
    loadConfig();

    return () => {
      // Optional: Cleanup live session? Or just leave it.
    };
  }, []);

  const searchCustomers = async () => {
    if (!kintoneConfig?.domain || !kintoneConfig?.customerAppId || !kintoneConfig?.customerApiToken) {
      setLookupError('Kintoneの顧客データベース設定（顧客アプリID、トークン等）が未設定です。設定画面から設定を行ってください。');
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
          keyword: customerKeyword,
          nameField: kintoneConfig.customerNameField || '顧客名',
          numberField: kintoneConfig.customerNumberField || '顧客番号'
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '検索に失敗しました。');
      }
      setCustomers(data.customers || []);
      if (!data.customers || data.customers.length === 0) {
        setLookupError('該当する顧客が見つかりませんでした。');
      }
    } catch (err: any) {
      console.error(err);
      setLookupError(err.message || 'エラーが発生しました。');
    } finally {
      setIsSearchingCustomers(false);
    }
  };

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

  const saveRecording = async () => {
    if (audioChunksRef.current.length === 0 || !auth.currentUser) return;
    setIsSaving(true);
    
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, `recording-${Date.now()}.webm`);
      formData.append('title', selectedCustomer 
        ? `記録: ${selectedCustomer.name}様 (${new Date().toLocaleDateString('ja-JP')})`
        : `記録: ${new Date().toLocaleString('ja-JP')}`
      );
      formData.append('text', text);

      // Upload file to server-side local disk (to avoid complex Storage setup)
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
      
      // Fetch Gemini result from live session if available
      let geminiResult = '';
      try {
        const sessionDoc = await getDoc(doc(db, 'liveSessions', sessionId));
        geminiResult = sessionDoc.exists() ? (sessionDoc.data()?.geminiResult || '') : '';
      } catch (_) { /* ignore */ }

      // Save metadata to Firestore
      try {
        await addDoc(collection(db, 'recordings'), {
          title: selectedCustomer
            ? `記録: ${selectedCustomer.name}様 (${new Date().toLocaleDateString('ja-JP')})`
            : `記録: ${new Date().toLocaleString('ja-JP')}`,
          text: text,
          audioUrl: uploadedData.audioUrl,
          createdAt: Date.now(),
          kintoneSynced: false,
          userId: auth.currentUser.uid,
          customerNumber: selectedCustomer?.number || '',
          customerName: selectedCustomer?.name || '',
          participants: participantsList,
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

      {/* Kintone Customer Lookup & Meeting Participants Panel */}
      <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100">
        
        {/* Kintone 顧客ルックアップ */}
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight flex items-center">
              <Search className="w-4.5 h-4.5 mr-2 text-blue-600" />
              Kintone 顧客ルックアップ
            </h3>
            {selectedCustomer && (
              <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center">
                <Check className="w-3 h-3 mr-1" />
                選択済み
              </span>
            )}
          </div>

          {selectedCustomer ? (
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">選択された顧客</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  {selectedCustomer.name} <span className="text-slate-500 text-xs font-normal">({selectedCustomer.number})</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-full transition-colors"
                title="選択を解除"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="顧客名、または顧客番号で検索..."
                  value={customerKeyword}
                  onChange={(e) => setCustomerKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      searchCustomers();
                    }
                  }}
                  className="flex-1 border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
                />
                <button
                  type="button"
                  onClick={searchCustomers}
                  disabled={isSearchingCustomers}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors flex items-center shrink-0"
                >
                  {isSearchingCustomers ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Search className="w-4 h-4 mr-1.5" />
                  )}
                  検索
                </button>
              </div>

              {lookupError && (
                <p className="text-xs text-red-500 font-medium">{lookupError}</p>
              )}

              {customers.length > 0 && (
                <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100 shadow-inner bg-white">
                  {customers.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomers([]);
                        setCustomerKeyword('');
                        setLookupError(null);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex justify-between items-center text-xs text-slate-700"
                    >
                      <span className="font-bold font-sans">{c.name || '名称未設定'}</span>
                      <span className="font-mono text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                        {c.number || '番号なし'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
