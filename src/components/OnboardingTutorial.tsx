import React, { useState } from 'react';
import { Radio, Mic, Share2, Search, FileText, ChevronRight, ChevronLeft, X, Sparkles } from 'lucide-react';

const ONBOARDING_KEY = 'recordingApp_onboardingDone';

export function hasCompletedOnboarding(): boolean {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { return false; }
}

export function markOnboardingDone(): void {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
}

interface Step {
  icon: typeof Radio;
  title: string;
  description: string;
  mockScreen: React.ReactNode;
}

function MockPhone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[280px] bg-slate-900 rounded-[2rem] p-2 shadow-2xl">
      <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] overflow-hidden h-[400px] flex flex-col">
        {children}
      </div>
    </div>
  );
}

const steps: Step[] = [
  {
    icon: Radio,
    title: 'レコーディングアプリへようこそ',
    description: '会議を録音して、自動で文字起こし・要約・CRM同期まで行うアプリです。',
    mockScreen: (
      <MockPhone>
        <div className="bg-white dark:bg-slate-800 h-full flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg">
            <Radio className="w-7 h-7" />
          </div>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 mb-1">レコーディングアプリ</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            録音 → 文字起こし → AI要約 → CRM同期<br />
            すべて自動で完了します
          </p>
        </div>
      </MockPhone>
    ),
  },
  {
    icon: Mic,
    title: '録音を開始する',
    description: '録音ボタンを押して会議を録音。顧客番号でCRMルックアップ、参加者の追加、ファイル添付も録音中に行えます。',
    mockScreen: (
      <MockPhone>
        <div className="bg-blue-600 px-3 py-2 flex items-center gap-2">
          <div className="w-5 h-5 bg-white/20 rounded flex items-center justify-center"><Radio className="w-3 h-3 text-white" /></div>
          <span className="text-white text-xs font-bold">録音</span>
        </div>
        <div className="flex-1 p-3 space-y-2 bg-slate-50 dark:bg-slate-900">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] font-bold text-slate-400 mb-1">顧客番号</p>
            <div className="bg-slate-100 dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-400">番号を入力...</div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] font-bold text-slate-400 mb-1">参加者</p>
            <div className="flex gap-1">
              <span className="bg-blue-100 text-blue-700 text-[9px] px-1.5 py-0.5 rounded-full font-bold">田中 太郎</span>
              <span className="bg-blue-100 text-blue-700 text-[9px] px-1.5 py-0.5 rounded-full font-bold">+ 追加</span>
            </div>
          </div>
          <div className="flex justify-center pt-2">
            <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
              <Mic className="w-7 h-7 text-white" />
            </div>
          </div>
          <p className="text-center text-[10px] text-red-500 font-bold">● 録音中 00:32</p>
        </div>
      </MockPhone>
    ),
  },
  {
    icon: Share2,
    title: 'ライブ同期で共同作業',
    description: 'PCで録音を開始し、iPhoneからライブ同期に参加。ファイル追加や顧客情報の共有がリアルタイムで行えます。',
    mockScreen: (
      <MockPhone>
        <div className="bg-emerald-600 px-3 py-2 flex items-center gap-2">
          <Share2 className="w-4 h-4 text-white" />
          <span className="text-white text-xs font-bold">ライブ同期</span>
        </div>
        <div className="flex-1 p-3 space-y-2 bg-emerald-50 dark:bg-slate-900">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-emerald-200 dark:border-slate-700">
            <p className="text-[10px] font-bold text-emerald-600 mb-1">接続中</p>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs text-slate-700 dark:text-slate-300 font-bold">セッション: A1B2C3</span>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-emerald-200 dark:border-slate-700">
            <p className="text-[10px] font-bold text-slate-400">顧問先</p>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">㈱サンプル商事</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-2 border border-emerald-200 dark:border-slate-700">
            <p className="text-[10px] text-slate-500 leading-relaxed">話者1: 今期の決算について...</p>
            <p className="text-[10px] text-slate-500 leading-relaxed">話者2: はい、売上は...</p>
          </div>
        </div>
      </MockPhone>
    ),
  },
  {
    icon: Search,
    title: '履歴で確認・編集',
    description: '過去の録音を検索し、AI要約の確認・編集・再生成が可能。CRMへの手動同期もここから行えます。',
    mockScreen: (
      <MockPhone>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">履歴</span>
        </div>
        <div className="flex-1 p-3 space-y-2 bg-slate-50 dark:bg-slate-900">
          <div className="bg-white dark:bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-1">
              <Search className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] text-slate-400">キーワード検索...</span>
            </div>
          </div>
          {[
            { title: '㈱サンプル商事 打合せ', date: '2026/07/05', synced: true },
            { title: '㈲田中建設 決算', date: '2026/07/03', synced: true },
            { title: '個人 田中太郎 確定申告', date: '2026/07/01', synced: false },
          ].map((r, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-800 dark:text-slate-200 truncate">{r.title}</p>
                {r.synced ? (
                  <span className="text-[8px] bg-green-100 text-green-700 px-1 rounded font-bold">同期済</span>
                ) : (
                  <span className="text-[8px] bg-yellow-100 text-yellow-700 px-1 rounded font-bold">未同期</span>
                )}
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5">{r.date}</p>
            </div>
          ))}
        </div>
      </MockPhone>
    ),
  },
  {
    icon: FileText,
    title: 'AI要約で効率化',
    description: '録音完了後にAIが議事録を自動生成。議題・内容・宿題・次回予定の構成で、手動編集や再生成も可能です。',
    mockScreen: (
      <MockPhone>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">AI要約</span>
        </div>
        <div className="flex-1 p-3 bg-slate-50 dark:bg-slate-900 overflow-auto text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-1.5">
          <p className="font-bold text-slate-900 dark:text-slate-100">## 議題</p>
          <p>今期決算の進捗確認と来期の方針検討</p>
          <p className="font-bold text-slate-900 dark:text-slate-100 mt-2">## 内容・決定事項</p>
          <p>・売上前期比105%で推移</p>
          <p>・減価償却の特例適用を検討</p>
          <p>・消費税の簡易課税選択について確認</p>
          <p className="font-bold text-slate-900 dark:text-slate-100 mt-2">## 宿題・アクション</p>
          <p>・田中：特例適用の試算を7/10までに作成</p>
          <p className="font-bold text-slate-900 dark:text-slate-100 mt-2">## 次回打合せ予定</p>
          <p>7月20日 14:00</p>
        </div>
      </MockPhone>
    ),
  },
];

export function OnboardingTutorial({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;
  const Icon = current.icon;

  const finish = () => {
    markOnboardingDone();
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-bold text-slate-500 dark:text-slate-400">{step + 1} / {steps.length}</span>
          </div>
          <button onClick={finish} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pt-3 pb-2 text-center">
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mb-1">{current.title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{current.description}</p>
        </div>

        {/* Mock screen */}
        <div className="px-5 py-4">
          {current.mockScreen}
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 pb-3">
          {steps.map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-blue-600 w-6' : 'bg-slate-300 dark:bg-slate-600'}`} />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex gap-2 px-5 pb-5">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 flex items-center justify-center gap-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-colors active:scale-95 text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              戻る
            </button>
          )}
          <button
            onClick={isLast ? finish : () => setStep(step + 1)}
            className="flex-1 flex items-center justify-center gap-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors active:scale-95 text-sm"
          >
            {isLast ? 'はじめる' : '次へ'}
            {!isLast && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
