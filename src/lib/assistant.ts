import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
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
      console.error('Failed to parse saved assistant settings', e);
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

export async function fetchPastTranscripts(
  userId: string,
  limit = 5,
  customerNumber?: string
): Promise<PastTranscript[]> {
  try {
    const constraints = [where('userId', '==', userId)];
    if (customerNumber) {
      constraints.push(where('customerNumber', '==', customerNumber));
    }
    const q = query(collection(db, 'recordings'), ...constraints);
    const snapshot = await getDocs(q);
    const recordings = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        title: data.title || '無題',
        createdAt: data.createdAt || 0,
        text: (data.text || '').slice(0, 1500),
        summary: data.summary || undefined,
      } as PastTranscript;
    });
    // Sorted client-side to avoid requiring a composite Firestore index
    recordings.sort((a, b) => b.createdAt - a.createdAt);
    return recordings.slice(0, limit);
  } catch (error: any) {
    handleFirestoreError(error, OperationType.GET, 'recordings');
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
