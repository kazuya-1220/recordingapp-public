export interface MemberInfo {
  name: string;   // display name (keeps the half-width space)
  email: string;
  kana: string;   // katakana furigana — internal search keyword only, never displayed
}

// NOTE: All names/emails below are fictional, for the public demo only.
export const TAX_BRAIN_MEMBERS_INFO: MemberInfo[] = [
  { name: '田中 太郎',   email: 'tanaka@tax-brain.page',    kana: 'タナカタロウ' },
  { name: '鈴木 花子',   email: 'suzuki@tax-brain.page',    kana: 'スズキハナコ' },
  { name: '高橋 健一',   email: 'takahashi@tax-brain.page', kana: 'タカハシケンイチ' },
  { name: '渡辺 美咲',   email: 'watanabe@tax-brain.page',  kana: 'ワタナベミサキ' },
  { name: '伊藤 大輔',   email: 'itou@tax-brain.page',      kana: 'イトウダイスケ' },
  { name: '山田 由美',   email: 'yamada@tax-brain.page',    kana: 'ヤマダユミ' },
  { name: '中村 翔太',   email: 'nakamura@tax-brain.page',  kana: 'ナカムラショウタ' },
  { name: '小林 彩香',   email: 'kobayashi@tax-brain.page', kana: 'コバヤシアヤカ' },
  { name: '加藤 直樹',   email: 'katou@tax-brain.page',     kana: 'カトウナオキ' },
  { name: '吉田 恵子',   email: 'yoshida@tax-brain.page',   kana: 'ヨシダケイコ' },
  { name: '松本 亮',     email: 'matsumoto@tax-brain.page', kana: 'マツモトリョウ' },
  { name: '井上 真央',   email: 'inoue@tax-brain.page',     kana: 'イノウエマオ' },
  { name: '木村 拓也',   email: 'kimura@tax-brain.page',    kana: 'キムラタクヤ' },
  { name: '林 さやか',   email: 'hayashi@tax-brain.page',   kana: 'ハヤシサヤカ' },
  { name: '清水 隆',     email: 'shimizu@tax-brain.page',   kana: 'シミズタカシ' },
  // Map the demo sign-in account to a fictional display name so participant
  // auto-selection still resolves for whoever is testing.
  { name: '山下 一馬',   email: 'kazuya@tax-brain.page',    kana: 'ヤマシタカズマ' },
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
