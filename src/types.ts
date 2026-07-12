export interface Recording {
  id: string;
  title: string;
  text: string;
  audioUrl: string | null;
  createdAt: number;
  kintoneSynced: boolean;
  summary?: string;
  geminiResult?: string;
  customerNumber?: string;
  customerName?: string;
  participants?: string[];
}

export interface KintoneSettings {
  domain: string;
  appId: string;
  apiToken: string;
  customerAppId?: string;
  customerApiToken?: string;
  customerNameField?: string;
  customerNumberField?: string;
}

export interface SyncResult {
  success?: boolean;
  error?: string;
}

export interface AssistantSettings {
  triggerWord: string;
}

export interface ChatSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: ChatSource[];
}

export interface PastTranscript {
  title: string;
  createdAt: number;
  text: string;
  summary?: string;
}
