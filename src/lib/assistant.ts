import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { AssistantSettings, ChatSource, PastTranscript } from '../types';

const STORAGE_KEY = 'assistant_settings';

export const DEFAULT_TRIGGER_WORD = '私の方で調べておきます';

export function getAssistantSettings(): AssistantSettings {
  const savedStr = localStorage.getItem(STORAGE_KEY);
  if (savedStr) {
    try {
      const saved = JSON.parse(savedStr) as Partial<AssistantSettings>;
      return { triggerWord: saved.triggerWord || DEFAULT_TRIGGER_WORD };
    } catch (e) {
      console.error('Failed to parse assistant settings', e);
    }
  }
  return { triggerWord: DEFAULT_TRIGGER_WORD };
}

export function saveAssistantSettings(settings: AssistantSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function countOccurrences(text: string, word: string): number {
  if (!text || !word) return 0;
  let count = 0;
  let index = text.indexOf(word);
  while (index !== -1) {
    count++;
    index = text.indexOf(word, index + word.length);
  }
  return count;
}

// Convert full-width katakana → hiragana and lowercase, for kana-agnostic matching
function normalizeKana(s: string): string {
  return s
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
}

// Fuzzy occurrence count: ignores hiragana/katakana/case differences
export function fuzzyCountOccurrences(text: string, word: string): number {
  if (!text || !word) return 0;
  const normText = normalizeKana(text);
  const normWord = normalizeKana(word);
  if (!normWord) return 0;
  let count = 0, pos = 0;
  while ((pos = normText.indexOf(normWord, pos)) !== -1) {
    count++;
    pos += normWord.length;
  }
  return count;
}

export async function detectNeedsInvestigation(transcript: string): Promise<boolean> {
  try {
    const res = await fetch('/api/assistant/detect-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.needsInvestigation;
  } catch {
    return false;
  }
}

// Fetch past transcripts for the same customer (across all users).
// エラー時は静かに空配列を返す。過去の文字起こしはあくまで補助的なコンテキスト。
export async function fetchPastTranscripts(userId: string, customerNumber?: string, limit = 5): Promise<PastTranscript[]> {
  try {
    let q;
    if (customerNumber && customerNumber.trim()) {
      // Prioritize: all recordings for this customer number (any user)
      q = query(collection(db, 'recordings'), where('customerNumber', '==', customerNumber.trim()));
    } else if (userId) {
      // Fallback: current user's recent recordings when no customer context
      q = query(collection(db, 'recordings'), where('userId', '==', userId));
    } else {
      return [];
    }
    const snapshot = await getDocs(q);
    const recordings = snapshot.docs.map((d) => {
      const data = d.data() as any;
      return {
        title: data.title || '無題',
        createdAt: data.createdAt || 0,
        text: (data.text || '').slice(0, 1500),
        summary: data.summary || undefined,
        customerNumber: data.customerNumber || '',
      } as PastTranscript & { customerNumber: string };
    });
    recordings.sort((a, b) => b.createdAt - a.createdAt);
    return recordings.slice(0, limit);
  } catch (error: any) {
    console.warn('Failed to fetch past transcripts (assistant):', error?.message || error);
    return [];
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `サーバーエラー (HTTP ${res.status})`);
  }
  return data as T;
}

export async function extractTask(transcript: string, triggerWord: string): Promise<string> {
  const data = await postJson<{ task: string }>('/api/assistant/extract-task', {
    transcript,
    triggerWord,
  });
  return data.task;
}

export async function sendAssistantChat(payload: {
  messages: { role: 'user' | 'assistant'; content: string }[];
  transcript: string;
  pastTranscripts: PastTranscript[];
}): Promise<{ reply: string; sources: ChatSource[] }> {
  const data = await postJson<{ reply: string; sources?: ChatSource[] }>(
    '/api/assistant/chat',
    payload
  );
  return { reply: data.reply, sources: data.sources || [] };
}
