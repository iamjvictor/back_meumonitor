type QuestionGenerationEnumState = { hasCorrection: boolean; hasNormalization: boolean };
type Query = () => Promise<QuestionGenerationEnumState[]>;

export async function loadQuestionGenerationEnumState(
  query: Query,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<QuestionGenerationEnumState> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 1000);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [state] = await query();
      if (!state) throw new Error('WORKER_DATABASE_BOOTSTRAP_EMPTY_RESULT');
      console.log('Verificação do schema do worker concluída', { event: 'payments.worker_database_check_completed', attempt, attempts });
      return state;
    } catch (error) {
      lastError = error;
      console.warn('Verificação do schema do worker falhou', {
        event: 'payments.worker_database_check_failed',
        attempt,
        attempts,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
