// 同時翻訳機能で扱う言語の定義。
// 文字起こしは日本語（ja）を基準（ソース）とし、それ以外に選択された言語へ翻訳する。
// 会話メニューでは「その会話内で発生する言語」を複数選択でき、初期値は日本語のみ
// （＝翻訳不要）。ja 以外が選ばれると、その言語が翻訳ターゲットになる。

export interface LanguageDef {
  code: string;      // 内部コード（Firestore・API のキー）
  label: string;     // 日本語表示名
  native: string;    // その言語での自称表記（UIチップ用）
  gemini: string;    // Gemini への翻訳指示で使う言語名
}

// ソース言語（文字起こしの基準）。常に選択済み扱い。
export const SOURCE_LANGUAGE = 'ja';

export const LANGUAGES: LanguageDef[] = [
  { code: 'ja',    label: '日本語',        native: '日本語',     gemini: 'Japanese' },
  { code: 'en',    label: '英語',          native: 'English',    gemini: 'English' },
  { code: 'zh-CN', label: '中国語（簡体）', native: '简体中文',   gemini: 'Simplified Chinese' },
  { code: 'zh-TW', label: '中国語（繁体）', native: '繁體中文',   gemini: 'Traditional Chinese' },
  { code: 'ko',    label: '韓国語',        native: '한국어',     gemini: 'Korean' },
  { code: 'vi',    label: 'ベトナム語',    native: 'Tiếng Việt', gemini: 'Vietnamese' },
  { code: 'th',    label: 'タイ語',        native: 'ไทย',        gemini: 'Thai' },
  { code: 'tl',    label: 'フィリピン語',  native: 'Filipino',   gemini: 'Filipino (Tagalog)' },
  { code: 'id',    label: 'インドネシア語', native: 'Bahasa Indonesia', gemini: 'Indonesian' },
  { code: 'pt',    label: 'ポルトガル語',  native: 'Português',  gemini: 'Portuguese' },
  { code: 'es',    label: 'スペイン語',    native: 'Español',    gemini: 'Spanish' },
  { code: 'fr',    label: 'フランス語',    native: 'Français',   gemini: 'French' },
  { code: 'de',    label: 'ドイツ語',      native: 'Deutsch',    gemini: 'German' },
  { code: 'ne',    label: 'ネパール語',    native: 'नेपाली',      gemini: 'Nepali' },
];

const LANG_BY_CODE = new Map(LANGUAGES.map(l => [l.code, l]));

export function getLanguage(code: string): LanguageDef | undefined {
  return LANG_BY_CODE.get(code);
}

export function languageLabel(code: string): string {
  return LANG_BY_CODE.get(code)?.label || code;
}

// 選択された言語配列を正規化：ja を必ず先頭に含め、重複・未知コードを除去し、
// 定義順で安定ソートする。
export function normalizeLanguages(codes: string[] | undefined | null): string[] {
  const set = new Set<string>([SOURCE_LANGUAGE, ...((codes || []).filter(c => LANG_BY_CODE.has(c)))]);
  return LANGUAGES.filter(l => set.has(l.code)).map(l => l.code);
}

// 実際に翻訳が必要なターゲット言語（＝ソース ja を除いた選択言語）。
export function translationTargets(codes: string[] | undefined | null): string[] {
  return normalizeLanguages(codes).filter(c => c !== SOURCE_LANGUAGE);
}

// 翻訳が有効か（ja 以外が1つ以上選ばれているか）。
export function hasTranslation(codes: string[] | undefined | null): boolean {
  return translationTargets(codes).length > 0;
}
