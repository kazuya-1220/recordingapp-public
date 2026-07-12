export interface MemberInfo {
  name: string;   // display name (keeps the half-width space)
  email: string;
  kana: string;   // katakana furigana — internal search keyword only, never displayed
}

export const TAX_BRAIN_MEMBERS_INFO: MemberInfo[] = [
  { name: '原 寿基',     email: 'hara@tax-brain.page',       kana: 'ハラヒサキ' },
  { name: '佐藤 孝明',   email: 'satou@tax-brain.page',      kana: 'サトウタカアキ' },
  { name: '近藤 信二',   email: 'kondou@tax-brain.page',     kana: 'コンドウシンジ' },
  { name: '牧野 香久美', email: 'makino@tax-brain.page',     kana: 'マキノカグミ' },
  { name: '成田 さや香', email: 'narita@tax-brain.page',     kana: 'ナリタサヤカ' },
  { name: '会田 大悟',   email: 'aida@tax-brain.page',       kana: 'アイダダイゴ' },
  { name: '田澤 もえ子', email: 'tazawa@tax-brain.page',     kana: 'タザワモエコ' },
  { name: '佐々木 数彌', email: 'kazuya@tax-brain.page',     kana: 'ササキカズヤ' },
  { name: '池内 美穂',   email: 'ikeuchi@tax-brain.page',    kana: 'イケウチミホ' },
  { name: '上野 恭平',   email: 'ueno@tax-brain.page',       kana: 'ウエノキョウヘイ' },
  { name: '山本 和輝',   email: 'yamamoto@tax-brain.page',   kana: 'ヤマモトカズキ' },
  { name: '岡部 瑠一',   email: 'okabe@tax-brain.page',      kana: 'オカベルイ' },
  { name: '堀越 貴裕',   email: 'horikoshi@tax-brain.page',  kana: 'ホリコシタカヒロ' },
  { name: '川下 千春',   email: 'kawashita@tax-brain.page',  kana: 'カワシタチハル' },
  { name: '大村 葵',     email: 'aoi@tax-brain.page',        kana: 'オオムラアオイ' },
  { name: '沢田 秀和',   email: 'sawada@tax-brain.page',     kana: 'サワダヒデカズ' },
  { name: '大野 美緒',   email: 'oono@tax-brain.page',       kana: 'オオノミオ' },
  { name: '村上 結子',   email: 'murakami@tax-brain.page',   kana: 'ムラカミユウコ' },
  { name: '向井 香織',   email: 'mukai@tax-brain.page',      kana: 'ムカイカオリ' },
  { name: '荒木 智香子', email: 'araki@tax-brain.page',      kana: 'アラキチカコ' },
  { name: '髙栁 由美',   email: 'takayanagi@tax-brain.page', kana: 'タカヤナギユミ' },
  { name: '池内 みどり', email: 'midori@tax-brain.page',     kana: 'イケウチミドリ' },
];

export const TAX_BRAIN_MEMBERS: string[] = TAX_BRAIN_MEMBERS_INFO.map(m => m.name);

export function getEmailByName(name: string): string | undefined {
  return TAX_BRAIN_MEMBERS_INFO.find(m => m.name === name)?.email;
}

export function getNameByEmail(email: string): string | undefined {
  return TAX_BRAIN_MEMBERS_INFO.find(m => m.email === email)?.name;
}

// Katakana → Hiragana (so users can search internal members by either kana form)
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * Internal search index for a member display name. Combines several keyword
 * forms so a member can be found by kanji (with or without the space),
 * katakana furigana, hiragana furigana, or the romaji from their email.
 * The furigana is used only for matching — it is never shown in the UI.
 */
export function memberSearchIndex(name: string): string {
  const info = TAX_BRAIN_MEMBERS_INFO.find(m => m.name === name);
  const parts: string[] = [name, name.replace(/\s+/g, '')];
  if (info) {
    if (info.kana) {
      parts.push(info.kana, kataToHira(info.kana));
    }
    if (info.email) parts.push(info.email.split('@')[0]);
  }
  return parts.join(' ').toLowerCase();
}

/** True if `name` matches a free-word `query` (kanji w/wo space, kana, romaji). */
export function memberMatchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const idx = memberSearchIndex(name);
  return idx.includes(q) || idx.includes(q.replace(/\s+/g, ''));
}
