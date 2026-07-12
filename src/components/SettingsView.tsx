import React, { useState, useEffect } from 'react';
import { Moon, Sun, LogOut, Mic2, MessageCircle, ClipboardList, HelpCircle, Sliders, Sparkles, Save } from 'lucide-react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { useTheme, FONT_SIZE_OPTIONS } from '../contexts/ThemeContext';
import { ViewState } from '../App';
import { AssistantSettings } from '../types';
import { getAssistantSettings, saveAssistantSettings, DEFAULT_TRIGGER_WORD } from '../lib/assistant';

function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

const BETA_USERS = new Set(['kazuya@tax-brain.page']);

export function SettingsView({ onViewChange, userEmail }: { onViewChange: (view: ViewState) => void; userEmail?: string }) {
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  const isBetaUser = BETA_USERS.has(userEmail || '');

  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>({
    triggerWord: DEFAULT_TRIGGER_WORD
  });
  const [assistantSaved, setAssistantSaved] = useState(false);

  useEffect(() => {
    setAssistantSettings(getAssistantSettings());
  }, []);

  const handleAssistantSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveAssistantSettings({
      triggerWord: assistantSettings.triggerWord.trim() || DEFAULT_TRIGGER_WORD
    });
    setAssistantSettings(getAssistantSettings());
    setAssistantSaved(true);
    setTimeout(() => setAssistantSaved(false), 3000);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    onViewChange('dashboard');
  };

  return (
    <div className="space-y-6 pb-36 mt-4">
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">設定</h2>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">テーマ</h3>
        <div className="flex gap-3">
          <button
            onClick={() => setTheme('light')}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 transition-all duration-200 font-bold active:scale-95 ${
              theme === 'light'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
            }`}
          >
            <Sun className="w-5 h-5" />
            ライトモード
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 transition-all duration-200 font-bold active:scale-95 ${
              theme === 'dark'
                ? 'border-blue-500 bg-blue-900/30 text-blue-400'
                : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
            }`}
          >
            <Moon className="w-5 h-5" />
            ダークモード
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">文字サイズ</h3>
        <div className="flex gap-2">
          {FONT_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFontSize(opt.key)}
              className={`flex-1 flex flex-col items-center justify-center py-3 rounded-xl border-2 transition-all duration-200 active:scale-95 ${
                fontSize === opt.key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <span style={{ fontSize: `${opt.px}px`, lineHeight: 1 }} className="font-bold mb-1">あ</span>
              <span className="text-[10px] font-bold">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-3">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          フィードバック・ヘルプ
        </h3>
        <button
          onClick={() => onViewChange('feedback')}
          className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl transition-all duration-200"
        >
          <MessageCircle className="w-5 h-5" />
          フィードバックを送る
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => onViewChange('reviews')}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-all duration-200 active:scale-95 border border-slate-200 dark:border-slate-600 text-sm"
          >
            <ClipboardList className="w-4 h-4" />
            レビュー一覧
          </button>
          <button
            onClick={() => onViewChange('help')}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-all duration-200 active:scale-95 border border-slate-200 dark:border-slate-600 text-sm"
          >
            <HelpCircle className="w-4 h-4" />
            使い方ガイド
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <GoogleLogo size={16} />
          Googleアカウント
        </h3>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 py-4 bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold rounded-xl transition-all duration-200"
        >
          <LogOut className="w-5 h-5" />
          ログアウト
        </button>
      </div>

      {/* Prompt settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
          <Sliders className="w-4 h-4" />
          プロンプト設定
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">AI要約の追加指示・ワード補正をアカウントごとに保存</p>
        <button
          onClick={() => onViewChange('prompt-settings')}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-slate-700 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 active:scale-95 text-white font-bold rounded-xl transition-all duration-200"
        >
          <Sliders className="w-5 h-5" />
          プロンプトを編集する
        </button>
      </div>

      {/* AI Assistant (ライブ同期画面の特定ワード検知) */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          AI アシスタント（ライブ同期）
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          ライブ同期中の会話に下記の特定ワードが出現すると、Geminiが自動で調査タスクを抽出し、Web検索＋過去の文字起こしを元に回答します。
        </p>
        <form onSubmit={handleAssistantSave} className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">
              特定ワード（トリガーワード）
            </label>
            <input
              type="text"
              value={assistantSettings.triggerWord}
              onChange={(e) => setAssistantSettings({ ...assistantSettings, triggerWord: e.target.value })}
              placeholder={DEFAULT_TRIGGER_WORD}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2.5 rounded-lg focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors text-sm"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-violet-600 hover:bg-violet-700 active:scale-95 text-white font-bold rounded-xl transition-all duration-200"
          >
            {assistantSaved ? (
              '保存しました'
            ) : (
              <>
                <Save className="w-4 h-4" />
                特定ワードを保存
              </>
            )}
          </button>
        </form>
      </div>

      {isBetaUser && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
            <Mic2 className="w-4 h-4" />
            ベータ機能
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">話者分離録音（試験運用中）</p>
          <button
            onClick={() => onViewChange('voiceprint')}
            className="w-full flex items-center justify-center gap-2 py-4 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-bold rounded-xl transition-all duration-200"
          >
            <Mic2 className="w-5 h-5" />
            声紋版（話者分離録音）を開く
          </button>
        </div>
      )}
    </div>
  );
}
