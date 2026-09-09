import type { ChatHistoryMessage } from './chat-history.model.js';

export type ChatPromptRole = 'system' | 'user' | 'assistant';

export type ChatPromptMessage = {
  role: ChatPromptRole;
  content: string;
};

export type AuthorizedQuestionContext = {
  questionId: string;
  questionAttemptId?: string | null;
  monitorId: string;
  subjectId: string;
  topicId?: string | null;
  number?: number | null;
  topic?: string | null;
  statement: string;
  options: Array<{ label: string; text: string }>;
  selectedOption?: string | null;
  /** Metadados internos da fonte; não são incluídos no prompt. */
  sourceDocumentId?: string | null;
  sourceBlockId?: string | null;
};

export type ChatGenerationInput = {
  message: string;
  history: ChatHistoryMessage[];
  questionContext: AuthorizedQuestionContext | null;
  ragContext?: string | null;
  monitorId: string;
  subjectId: string;
};
