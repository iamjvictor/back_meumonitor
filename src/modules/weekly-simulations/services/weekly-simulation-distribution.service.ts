export type WeeklySimulationQuestion = {
  id: string;
  subjectId: string;
  topicId: string | null;
  text?: string;
};

export type WeeklySimulationTopicPool = {
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  difficultyScore: number;
  questions: WeeklySimulationQuestion[];
};

export type WeeklySelectedQuestion = WeeklySimulationQuestion & {
  difficultyScore: number;
  selectionPriority: 'NEVER_ANSWERED' | 'PREVIOUSLY_INCORRECT' | 'PREVIOUSLY_CORRECT';
  selectionReason: string;
};

function priority(questionId: string, history: Map<string, boolean>) {
  const previous = history.get(questionId);
  if (previous === undefined) return 0;
  return previous ? 2 : 1;
}

function allocateCounts(pools: WeeklySimulationTopicPool[], targetCount: number): number[] {
  const counts = pools.map(() => 0);
  const totalAvailable = pools.reduce((sum, pool) => sum + pool.questions.length, 0);
  let remaining = Math.min(targetCount, totalAvailable);

  pools.forEach((pool, index) => {
    if (remaining > 0 && pool.questions.length > 0) {
      counts[index] = 1;
      remaining -= 1;
    }
  });

  while (remaining > 0) {
    let selectedIndex = -1;
    let selectedScore = -Infinity;
    pools.forEach((pool, index) => {
      const allocated = counts[index] ?? 0;
      if (allocated >= pool.questions.length) return;
      const weight = pool.difficultyScore > 0 ? pool.difficultyScore : 1;
      const score = weight / (allocated + 1);
      if (score > selectedScore || (score === selectedScore && pool.difficultyScore > (pools[selectedIndex]?.difficultyScore ?? -1))) {
        selectedIndex = index;
        selectedScore = score;
      }
    });
    if (selectedIndex < 0) break;
    counts[selectedIndex] = (counts[selectedIndex] ?? 0) + 1;
    remaining -= 1;
  }

  return counts;
}

export function distributeWeeklySimulationQuestions(input: {
  topics: WeeklySimulationTopicPool[];
  targetCount: number;
  history: Map<string, boolean>;
  random?: () => number;
}): WeeklySelectedQuestion[] {
  const random = input.random ?? Math.random;
  const counts = allocateCounts(input.topics, input.targetCount);
  const selected: WeeklySelectedQuestion[] = [];

  input.topics.forEach((pool, index) => {
    const candidates = [...pool.questions].sort((left, right) => priority(left.id, input.history) - priority(right.id, input.history));
    const take = counts[index] ?? 0;
    for (const question of candidates.slice(0, take)) {
      const previous = input.history.get(question.id);
      const selectionPriority = previous === undefined ? 'NEVER_ANSWERED' : previous ? 'PREVIOUSLY_CORRECT' : 'PREVIOUSLY_INCORRECT';
      selected.push({
        ...question,
        difficultyScore: pool.difficultyScore,
        selectionPriority,
        selectionReason: selectionPriority === 'NEVER_ANSWERED'
          ? 'Questão ainda não respondida pelo aluno.'
          : selectionPriority === 'PREVIOUSLY_INCORRECT'
            ? 'Questão respondida anteriormente com erro.'
            : 'Questão acertada anteriormente usada para completar a distribuição.',
      });
    }
  });

  for (let index = selected.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [selected[index], selected[swapIndex]] = [selected[swapIndex]!, selected[index]!];
  }
  return selected;
}
