import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';
import { LANGUAGES, SOURCE_LANGUAGE, languageLabel, translationTargets } from '../lib/languages';

// 「この会話で使う言語」を複数選択するカード。Recorder / LiveView 双方で使う。
// 日本語（ソース）は常に選択済みで外せない。ja 以外を選ぶと翻訳ターゲットになる。
// 初期状態（日本語のみ）＝翻訳なし。
export function LanguageMenu({
  selected,
  onChange,
  accent = 'blue',
  disabled = false,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  accent?: 'blue' | 'emerald';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const targets = translationTargets(selected);
  const iconColor = accent === 'emerald' ? 'text-emerald-600' : 'text-blue-600';
  const activeSelected = (code: string) => selected.includes(code) || code === SOURCE_LANGUAGE;
  const selClass = accent === 'emerald'
    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-slate-100'
    : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-slate-100';
  const chipClass = accent === 'emerald'
    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800'
    : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800';
  const checkColor = accent === 'emerald' ? 'text-emerald-600 dark:text-white' : 'text-blue-600 dark:text-white';

  const toggle = (code: string) => {
    if (code === SOURCE_LANGUAGE) return; // 日本語は常時ON
    const next = selected.includes(code)
      ? selected.filter(c => c !== code)
      : [...selected, code];
    onChange(next);
  };

  return (
    <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5 space-y-3">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
        <Languages className={`w-4 h-4 ${iconColor}`} />
        翻訳言語（この会話で使う言語）
        {targets.length > 0 && (
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${chipClass}`}>
            翻訳 {targets.length}言語
          </span>
        )}
      </h3>

      <div ref={boxRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors active:scale-[0.99] duration-150 disabled:opacity-50"
        >
          <span className="font-medium">言語を選択（複数可）</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
            <div className="max-h-60 overflow-y-auto">
              {LANGUAGES.map(lang => {
                const on = activeSelected(lang.code);
                const isSource = lang.code === SOURCE_LANGUAGE;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => toggle(lang.code)}
                    disabled={isSource}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${on ? selClass : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'} ${isSource ? 'cursor-default' : 'active:scale-[0.99] duration-150'}`}
                  >
                    <span className="font-medium">
                      {lang.label}
                      <span className="text-slate-400 dark:text-slate-500 ml-1.5 text-xs">{lang.native}</span>
                      {isSource && <span className="text-[10px] text-slate-400 ml-1.5">基準・文字起こし</span>}
                    </span>
                    {on && <Check className={`w-4 h-4 ${checkColor}`} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 選択サマリー */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${chipClass}`}>
          {languageLabel(SOURCE_LANGUAGE)}（原文）
        </span>
        {targets.map(code => (
          <span key={code} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border ${chipClass}`}>
            {languageLabel(code)}
            <button type="button" onClick={() => toggle(code)} className="hover:opacity-60" aria-label={`${languageLabel(code)} を解除`}>
              <span className="text-xs leading-none">×</span>
            </button>
          </span>
        ))}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
        日本語のみ＝翻訳なし。他の言語を選ぶと、文字起こし（日本語）を録音中は参考訳、録音後はきれいな確定訳として各言語で表示・保存します。
        ゆっくり・文脈の区切りを意識して話すと精度が上がります。
      </p>
    </div>
  );
}
