import React, { useState, useEffect } from 'react';
import { ViewState } from '../App';
import { KintoneSettings, AssistantSettings } from '../types';
import { Save, ExternalLink, Sparkles } from 'lucide-react';
import { getKintoneSettings } from '../lib/kintone';
import { getAssistantSettings, saveAssistantSettings, DEFAULT_TRIGGER_WORD } from '../lib/assistant';

export function SettingsView({ onViewChange }: { onViewChange: (view: ViewState) => void }) {
  const [settings, setSettings] = useState<KintoneSettings>({
    domain: '',
    appId: '',
    apiToken: '',
    customerAppId: '',
    customerApiToken: '',
    customerNameField: '顧客名',
    customerNumberField: '顧客番号'
  });
  const [saved, setSaved] = useState(false);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>({
    triggerWord: DEFAULT_TRIGGER_WORD
  });
  const [assistantSaved, setAssistantSaved] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const currentSettings = await getKintoneSettings();
      setSettings(currentSettings);
    }
    loadSettings();
    setAssistantSettings(getAssistantSettings());
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('kintone_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

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
      <h2 className="text-lg font-bold text-slate-900 tracking-tight">Integration Settings</h2>

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

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight mb-6 flex items-center">
          <img src="https://kintone.cybozu.co.jp/jp/favicon.ico" alt="" className="w-4 h-4 mr-2" />
          Kintone API config
        </h3>
        
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Subdomain</label>
            <input
              type="text"
              value={settings.domain}
              onChange={(e) => setSettings({ ...settings, domain: e.target.value })}
              placeholder="example.cybozu.com"
              className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
              required
            />
            <p className="text-[10px] text-slate-500 mt-1.5 font-medium">xxx.cybozu.com or xxx.kintone.com</p>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold text-slate-600 mb-3 uppercase tracking-wider">Main Recording App</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">App ID</label>
                <input
                  type="text"
                  value={settings.appId}
                  onChange={(e) => setSettings({ ...settings, appId: e.target.value })}
                  placeholder="123"
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">API Token</label>
                <input
                  type="password"
                  value={settings.apiToken}
                  onChange={(e) => setSettings({ ...settings, apiToken: e.target.value })}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-mono"
                  required
                />
                <p className="text-[10px] text-slate-500 mt-1.5 font-medium">Requires 'Add record' permissions.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold text-slate-600 mb-3 uppercase tracking-wider">Customer Database App (Lookup)</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Customer App ID</label>
                <input
                  type="text"
                  value={settings.customerAppId || ''}
                  onChange={(e) => setSettings({ ...settings, customerAppId: e.target.value })}
                  placeholder="e.g. 456 (Optional)"
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Customer API Token</label>
                <input
                  type="password"
                  value={settings.customerApiToken || ''}
                  onChange={(e) => setSettings({ ...settings, customerApiToken: e.target.value })}
                  placeholder="Customer App API Token (Optional)"
                  className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1.5 font-medium">Requires 'View records' permissions.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Customer Name Field Code</label>
                  <input
                    type="text"
                    value={settings.customerNameField || ''}
                    onChange={(e) => setSettings({ ...settings, customerNameField: e.target.value })}
                    placeholder="顧客名"
                    className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Customer No Field Code</label>
                  <input
                    type="text"
                    value={settings.customerNumberField || ''}
                    onChange={(e) => setSettings({ ...settings, customerNumberField: e.target.value })}
                    placeholder="顧客番号"
                    className="w-full border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm font-sans"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg text-xs leading-relaxed text-slate-600 mt-6 border border-slate-100">
            <p className="font-bold text-slate-700 mb-2">Required Kintone Form Fields:</p>
            <ul className="list-disc pl-5 space-y-1.5 font-medium">
              <li><span className="font-mono text-[10px] bg-slate-200 px-1 rounded text-slate-800">Title</span> (Text - Single line)</li>
              <li><span className="font-mono text-[10px] bg-slate-200 px-1 rounded text-slate-800">Text</span> (Text - Multi line)</li>
              <li><span className="font-mono text-[10px] bg-slate-200 px-1 rounded text-slate-800">Date</span> (Date)</li>
            </ul>
            <p className="mt-3 text-[10px] text-slate-400">Ensure the field codes match exactly.</p>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center py-2.5 px-4 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 transition-colors text-sm font-medium mt-4"
          >
            {saved ? 'Settings Saved' : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
