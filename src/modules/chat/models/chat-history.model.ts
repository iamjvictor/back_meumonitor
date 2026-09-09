export type ChatHistoryRole = 'student' | 'assistant' | 'system';

export type ChatHistoryContextAttachment = {
  type: 'QUESTION' | 'FLASHCARD';
  id: string;
  attemptId?: string | null;
  monitorId: string;
  subjectId: string;
};

export type ChatHistoryScope = {
  studentId: string;
  monitorId: string;
  subjectId: string;
};

export type ChatHistoryQuestionContext = {
  questionId: string;
  questionAttemptId?: string | null;
  monitorId: string;
  subjectId: string;
  topicId?: string | null;
  number?: number | null;
};

export type ChatHistoryMessage = {
  id: string;
  role: ChatHistoryRole;
  content: string;
  createdAt: string;
  questionContext?: ChatHistoryQuestionContext | null;
  contextAttachment?: ChatHistoryContextAttachment | null;
};
