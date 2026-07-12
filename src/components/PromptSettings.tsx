import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, RefreshCw, Loader2, Sliders } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ViewState } from '../App';

// Official prompts (kept in sync with server.ts manually)
const OFFICIAL_SUMMARY_EXTRA = '';
const OFFICIAL_WORD_CORRECTIONS = '';

const OFFICIAL_SUMMARY_PROMPT_REF = `【公式プロンプト（参考）】
以下の顧問先との打合せ記録から議事録を作成してください。

## 議題（テーマを1〜3行で）
## 内容・決定事項（箇条書き）
## 宿題・アクション（誰が・何を・いつまでに）
## 次回打合せ予定
## ファイル内容（添付ファイルの説明）

常体（だ・である調）で出力。数字・日付・固有名詞は正確に記載。`;

interface UserSettings {
  summaryExtraPrompt: string;
  wordCorrections: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  summaryExtraPrompt: OFFICIAL_SUMMARY_EXTRA,
  wordCorrections: OFFICIAL_WORD_CORRECTIONS,
};

export function PromptSettings({ onViewChange, userEmail }: {
  onViewChange: (v: ViewState) => void;
  userEmail: string;
}) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!userEmail) return;
    getDoc(doc(db, 'userSettings', userEmail)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setSettings({
          summaryExtraPrompt: d.summaryExtraPrompt ?? DEFAULT_SETTINGS.summaryExtraPrompt,
          wordCorrections: d.wordCorrections ?? DEFAULT_SETTINGS.wordCorrections,
        });
      }
    }).finally(() => setLoading(false));
  }, [userEmail]);

  const save = async () => {
    if (!userEmail) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'userSettings', userEmail), {
        summaryExtraPrompt: settings.summaryExtraPrompt,
        wordCorrections: settings.wordCorrections,
        updatedAt: Date.now(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const resetToOfficial = async () => {
    const next = { ...settings, summaryExtraPrompt: OFFICIAL_SUMMARY_EXTRA };
    setSettings(next);
    if (!userEmail) return;
    await setDoc(doc(db, 'userSettings', userEmail), {
      summaryExtraPrompt: OFFICIAL_SUMMARY_EXTRA,
      updatedAt: Date.now(),
    }, { merge: true });
  };

  if (loading) {
    return (
      <div className="mt-4 flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6 pb-36">
      <div className="flex items-center gap-3">
        <button onClick={() => onViewChange('settings')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-95">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Sliders className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">プロンプト設定</h2>
      </div>

      {/* Official prompt reference */}
      <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">公式プロンプト（参考・読み取り専用）</div>
        <pre className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap font-sans leading-relaxed">{OFFICIAL_SUMMARY_PROMPT_REF}</pre>
      </div>

      {/* Extra prompt */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">追加の指示</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">公式プロンプトに追加される指示文。録音ごとに自動で反映されます。</div>
          </div>
          <button
            onClick={resetToOfficial}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-300 dark:border-slate-600 px-3 py-1.5 rounded-lg transition-colors"
            title="追加の指示をクリア（公式のみに戻す）"
          >
            <RefreshCw className="w-3 h-3" />
            公式に戻す
          </button>
        </div>
        <textarea
          value={settings.summaryExtraPrompt}
          onChange={e => setSettings(prev => ({ ...prev, summaryExtraPrompt: e.target.value }))}
          placeholder="例：顧客名は必ず正式名称で記載すること。担当者名は省略しないこと。"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 resize-none"
          style={{ fontSize: '16px' }}
          rows={5}
        />
      </div>

      {/* Word corrections */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <div>
          <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">ワード補正・補足</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">よく誤変換される固有名詞や人名の補正をここに記載。要約時に参考にされます。</div>
        </div>
        <textarea
          value={settings.wordCorrections}
          onChange={e => setSettings(prev => ({ ...prev, wordCorrections: e.target.value }))}
          placeholder={`例：\nさわだ → 沢田\nたっくすぶれーん → タックスブレーン\nかずや → 佐々木数弥`}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 resize-none"
          style={{ fontSize: '16px' }}
          rows={6}
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-xl transition-colors active:scale-95 flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saved ? '保存しました ✓' : '保存する'}
      </button>
    </div>
  );
}

// Hook for loading user settings (used by Recorder)
export async function loadUserPromptSettings(userEmail: string): Promise<UserSettings> {
  if (!userEmail) return DEFAULT_SETTINGS;
  try {
    const snap = await getDoc(doc(db, 'userSettings', userEmail));
    if (snap.exists()) {
      const d = snap.data();
      return {
        summaryExtraPrompt: d.summaryExtraPrompt ?? '',
        wordCorrections: d.wordCorrections ?? '',
      };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function buildExtraInstruction(settings: UserSettings): string {
  const parts: string[] = [];
  if (settings.summaryExtraPrompt.trim()) parts.push(settings.summaryExtraPrompt.trim());
  if (settings.wordCorrections.trim()) parts.push(`【ワード補正】\n${settings.wordCorrections.trim()}`);
  return parts.join('\n\n');
}
