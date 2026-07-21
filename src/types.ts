export interface AttachmentInfo {
  url: string;
  name: string;
  ocrText?: string | null;
}

export interface TimedLine {
  ms: number;
  text: string;
}

export interface UpdateLogEntry {
  at: number;                            // epoch ms
  user: string;                          // email or displayName of the actor
  action: 'regenerate' | 'edit';         // what happened
  prompt?: string;                       // regenerate: the user prompt
  kintoneUpdated?: boolean;              // whether Kintone was also PUT-updated
}

export interface Recording {
  id: string;
  title: string;
  text: string;
  audioUrl: string | null;
  createdAt: number;
  kintoneSynced: boolean;
  summary?: string;
  geminiResult?: string;                 // Gemini Assistant auto-investigation result
  formattedText?: string | null;
  timedLines?: TimedLine[];
  customerNumber?: string;
  customerName?: string;
  customerSubmitNo?: string;             // submit_No from the customer DB lookup
  participants?: string[];
  participantEmails?: string[];          // internal participants' tax-brain emails
  kintoneRecordUrl?: string;
  kintoneRecordId?: string;              // for later PUTs (regen/edit)
  attachments?: AttachmentInfo[];
  summaryUpdateLog?: UpdateLogEntry[];   // audit trail for AI-summary edits
  // ── 同時翻訳（多言語）────────────────────────────────────────────────
  sourceLanguage?: string;               // 文字起こしの基準言語（通常 'ja'）
  translationLanguages?: string[];       // この記録で選択された言語コード（ja含む）
  translations?: Record<string, string>; // 言語コード → 確定翻訳テキスト
  translatedTimedLines?: Record<string, TimedLine[]>; // 言語コード → タイムライン訳
  // Legacy single-attachment fields (pre-v2)
  attachmentUrl?: string;
  attachmentName?: string;
}

export interface KintoneSettings {
  domain: string;
  appId: string;
  apiToken: string;
  customerAppId?: string;
  customerApiToken?: string;
  customerNameField?: string;
  customerNumberField?: string;
  customerSubmitField?: string;          // customer DB field for the submit id (default 'submit_No')
  lookupFieldCode?: string;
  staffFieldCode?: string;
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

export interface BetaFeedbackMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type ReviewStatus = 'open' | 'under_review' | 'accepted' | 'rejected' | 'in_progress' | 'released';

export interface BetaReview {
  id: string;
  userEmail: string;
  userName: string;
  title: string;
  description: string;
  conversation: BetaFeedbackMessage[];
  status: ReviewStatus;
  priority?: 'low' | 'medium' | 'high';
  adminNotes?: string;
  createdAt: number;
  updatedAt: number;
  aiAnalysis?: string;
}
