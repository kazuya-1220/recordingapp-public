import React, { useState, useEffect } from 'react';
import { ViewState } from '../App';
import { AssistantSettings } from '../types';
import { Save, Sparkles } from 'lucide-react';
import { getAssistantSettings, saveAssistantSettings, DEFAULT_TRIGGER_WORD } from '../lib/assistant';

export function SettingsView({ onViewChange }: { onViewChange: (view: ViewState) => void }) {
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

  return (
    <div className="max-w-xl mx-auto pt-4 space-y-6 pb-20">
      <h2 className="text-lg font-bold text-slate-900 tracking-tight">設定</h2>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight mb-6 flex items-center">
          <Sparkles className="w-4 h-4 mr-2 text-violet-600" />
          AI Assistant (Live Sync)
        </h3>

        <form onSubmit={handleAssistantSave} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">特定ワード（トリガーワード）</label>
            <input
              type="text"
              value={assistantSettings.triggerWord}
              onChange={(e) => setAssistantSettings({ ...assistantSettings, triggerWord: e.target.value })}
              placeholder={DEFAULT_TRIGGER_WORD}
              className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
              required
            />
            <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
              ライブ同期画面でこのワードが文字起こしに現れると、Geminiが会話内容から調査タスクを抽出し、自動で調査・回答を開始します。
            </p>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center py-2.5 px-4 bg-violet-600 text-white rounded-md shadow-sm hover:bg-violet-700 transition-colors text-sm font-medium"
          >
            {assistantSaved ? 'Settings Saved' : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Assistant Settings
              </>
            )}
          </button>
        </form>
      </div>

      <div className="bg-slate-50 p-4 rounded-lg text-xs leading-relaxed text-slate-600 border border-slate-100">
        <p className="font-bold text-slate-700 mb-1">このデモ版について</p>
        <p className="font-medium">
          外部公開用のデモ版です。録音・文字起こし・AI要約・ライブ同期・AIリサーチのみを提供し、
          外部業務システム（Kintone等）との連携機能は無効化しています。
        </p>
      </div>
    </div>
  );
}
