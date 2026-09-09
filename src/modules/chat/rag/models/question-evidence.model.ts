export type QuestionEvidenceSourceRole = 'STATEMENT' | 'ANSWER_KEY' | 'EXPLANATION' | 'CONTEXT';

export type QuestionEvidenceChunkStatus = 'READY' | 'EMBEDDING_PENDING' | 'FAILED' | string;

export type QuestionEvidenceSource = {
  role: QuestionEvidenceSourceRole;
  chunkStatus: QuestionEvidenceChunkStatus;
};

export type QuestionEvidenceSufficiencyInput = {
  correctAnswer: string | null;
  correctAnswerConfidence: number | null;
  sources: QuestionEvidenceSource[];
};

export type QuestionEvidenceResult = {
  strategy: 'DIRECT_QUESTION_SOURCE' | 'EVIDENCE_CACHE' | 'SEMANTIC_RETRIEVAL';
  sufficient: boolean;
  questionId: string;
  answer: string | null;
  explanation: string | null;
  citations: Array<{
    chunkId: string;
    documentId: string;
    blockId: string | null;
    role: QuestionEvidenceSourceRole;
    content: string;
    confidence: number | null;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
  context: string;
  metrics: {
    sourceCount: number;
    chunkCount: number;
    answerKeyCount: number;
    explanationCount: number;
    durationMs: number;
  };
};

export function isQuestionEvidenceSufficient(input: QuestionEvidenceSufficiencyInput) {
  const hasTrustedAnswer = Boolean(
    input.correctAnswer?.trim()
    && input.correctAnswerConfidence !== null
    && input.correctAnswerConfidence >= 0.8,
  );
  if (hasTrustedAnswer) return true;

  return input.sources.some((source) => (
    source.chunkStatus === 'READY'
    && (source.role === 'ANSWER_KEY' || source.role === 'EXPLANATION')
  ));
}
