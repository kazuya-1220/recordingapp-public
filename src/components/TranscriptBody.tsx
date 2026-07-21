import React from 'react';
import { TimedLine } from '../types';
import { SOURCE_LANGUAGE, languageLabel, translationTargets } from '../lib/languages';

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

// 文字起こしパネル上部の言語切替タブ。原文（日本語）＋選択された翻訳ターゲット言語。
// 翻訳ターゲットが1つも無いときは何も表示しない（従来UIのまま）。
export function TranscriptLangTabs({
  languages,
  activeLang,
  onSelect,
  accent = 'blue',
}: {
  languages: string[];
  activeLang: string;
  onSelect: (code: string) => void;
  accent?: 'blue' | 'emerald';
}) {
  const targets = translationTargets(languages);
  if (targets.length === 0) return null;
  const activeCls = accent === 'emerald' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white';
  const tabs = [SOURCE_LANGUAGE, ...targets];
  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 flex-wrap">
      {tabs.map((code, i) => (
        <button
          key={code}
          type="button"
          onClick={() => onSelect(code)}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${i > 0 ? 'border-l border-slate-200 dark:border-slate-600' : ''} ${
            activeLang === code
              ? activeCls
              : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600'
          }`}
        >
          {code === SOURCE_LANGUAGE ? '原文' : languageLabel(code)}
        </button>
      ))}
    </div>
  );
}

// 文字起こし本文。activeLang が日本語（原文）のときは従来どおり TL / 原文 を表示。
// 翻訳言語が選ばれているときは、その言語の翻訳テキストをブロック表示する。
export function TranscriptBody({
  activeLang,
  feedTab,
  timedLines,
  rawText,
  translations,
  isRecording = false,
  isWaiting = false,
  emptyLabel = 'ここに文字起こしデータが表示されます。',
}: {
  activeLang: string;
  feedTab: 'tl' | 'raw';
  timedLines: TimedLine[];
  rawText: string;
  translations?: Record<string, string> | null;
  isRecording?: boolean;
  isWaiting?: boolean;
  emptyLabel?: string;
}) {
  if (isWaiting) {
    return <p className="text-slate-400 italic text-center mt-8 text-sm">録音開始を待機中...</p>;
  }

  // ── 翻訳ビュー ────────────────────────────────────────────────
  if (activeLang && activeLang !== SOURCE_LANGUAGE) {
    const translated = translations?.[activeLang]?.trim() || '';
    if (translated) {
      return (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {languageLabel(activeLang)}（AI翻訳）
          </p>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{translated}</p>
        </div>
      );
    }
    return (
      <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">
        {isRecording ? <>翻訳を生成中<TypingDots /></> : `${languageLabel(activeLang)}の翻訳はまだありません。`}
      </p>
    );
  }

  // ── 原文（日本語）ビュー：従来ロジック ─────────────────────────
  if (feedTab === 'tl') {
    if (timedLines.length > 0) {
      return (
        <div className="space-y-2.5">
          {timedLines.map((line, i) => (
            <div key={i} className="flex gap-2.5 items-start text-sm">
              <span className="text-[11px] text-blue-500 dark:text-blue-400 shrink-0 mt-0.5 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded tabular-nums">
                {String(Math.floor(line.ms / 60000)).padStart(2, '0')}:{String(Math.floor((line.ms % 60000) / 1000)).padStart(2, '0')}
              </span>
              <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{line.text}</span>
            </div>
          ))}
          {isRecording && (
            <div className="flex gap-2.5 items-center">
              <span className="text-[11px] text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded w-[3.5rem] text-center">…</span>
              <TypingDots />
            </div>
          )}
        </div>
      );
    }
    return isRecording ? (
      <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
    ) : (
      <p className="text-slate-400 italic text-center mt-8 text-sm">{emptyLabel}</p>
    );
  }

  // raw
  return rawText ? (
    <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap">{rawText}</p>
  ) : isRecording ? (
    <p className="text-slate-400 text-center mt-8 text-sm flex items-center justify-center">音声認識中<TypingDots /></p>
  ) : (
    <p className="text-slate-400 italic text-center mt-8 text-sm">{emptyLabel}</p>
  );
}
