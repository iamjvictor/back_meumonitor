export type ChatQuestionAttemptReference = {
  studentId: string;
  questionId: string;
  monitorId: string;
  selectedAnswer: string;
};

export function isChatQuestionAttemptAuthorized(input: {
  attempt: ChatQuestionAttemptReference | null;
  studentId: string;
  questionId: string;
  monitorId: string;
}) {
  return Boolean(
    input.attempt
    && input.attempt.studentId === input.studentId
    && input.attempt.questionId === input.questionId
    && input.attempt.monitorId === input.monitorId,
  );
}

export function resolveChatSelectedOption(input: {
  attempt: ChatQuestionAttemptReference | null;
  requestedOption?: string | null;
}) {
  return input.attempt?.selectedAnswer ?? input.requestedOption ?? null;
}
