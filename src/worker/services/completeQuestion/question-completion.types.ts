export type QuestionAlternative = { label: string; text: string };

export type QuestionTopicInput = {
  id: string;
  name: string;
  index: number;
  definition?: string | null;
  classificationGuidance?: string | null;
  aiDefinition?: string | null;
  aiClassificationGuidance?: string | null;
};

export type QuestionAgentFailure = {
  agent: 'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION' | 'CATEGORY';
  code: string;
  model: string;
  finishReason?: string | null;
  attempts: number;
};

export type QuestionCompletionInput = {
  documentId: string;
  sourceBlockId: string | null;
  questionNumber: string | null;
  statement: string;
  alternatives: QuestionAlternative[];
  correctAnswer: string | null;
  explanation: string | null;
  sourceContext: string;
};

export type CompletionGeneration = {
  generationType: 'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION' | 'CATEGORY';
  model: string;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  confidence: number;
};

export type CompletedQuestion = {
  alternatives: QuestionAlternative[];
  correctAnswer: string | null;
  explanation: string | null;
  alternativesGenerated: boolean;
  answerGenerated: boolean;
  explanationGenerated: boolean;
  answerUsedDocumentRag: boolean;
  answerDecisionSource: 'SOURCE_DOCUMENT' | 'DOCUMENT_RAG' | 'MODEL_INFERENCE' | null;
  generations: CompletionGeneration[];
  missingFields: string[];
  failedAgents: Array<'ALTERNATIVES' | 'CORRECT_ANSWER' | 'EXPLANATION'>;
  agentFailures: QuestionAgentFailure[];
};
