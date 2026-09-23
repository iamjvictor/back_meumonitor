export type QuestionBankSelectionInput = {
  subject: string;
  topic: string;
  examType: string;
  board?: string | null;
  subtopic?: string | null;
  subsubtopic?: string | null;
};

export type NormalizedQuestionBankSelection = {
  subject: string;
  topic: string;
  examType: string;
  board: string | null;
  subtopic: string | null;
  subsubtopic: string | null;
  selectionKey: string;
};

export type MonitorTopicHierarchyInput = {
  name: string;
  definition?: string;
};

export type MonitorTopicHierarchyNode = {
  name: string;
  definition: string | null;
  position: number;
  subtopics: Array<{
    name: string;
    position: number;
    subsubtopics: Array<{ name: string; position: number }>;
  }>;
};

const normalizeText = (value: string | null | undefined) => {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  return normalized.length > 0 ? normalized : null;
};

const requireText = (value: string | null | undefined, field: string) => {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

const normalizeProfileValue = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
};

const selectionKeyPart = (value: string | null) => value?.toUpperCase() ?? '';

export function normalizeQuestionBankSelection(input: QuestionBankSelectionInput): NormalizedQuestionBankSelection {
  const subject = requireText(input.subject, 'subject');
  const topic = requireText(input.topic, 'topic');
  const examType = requireText(input.examType, 'examType').toUpperCase();
  const board = normalizeProfileValue(input.board);
  const subtopic = normalizeText(input.subtopic);
  const subsubtopic = normalizeText(input.subsubtopic);

  if (subsubtopic && !subtopic) {
    throw new Error('subsubtopic requires subtopic');
  }

  const selectionKey = [examType, board, subject, topic, subtopic, subsubtopic]
    .map(selectionKeyPart)
    .join('|');

  return {
    subject,
    topic,
    examType,
    board,
    subtopic,
    subsubtopic,
    selectionKey,
  };
}

export function buildSelectionWhere(selection: NormalizedQuestionBankSelection): Record<string, string | null> {
  const isGeneralSubtopic = normalizeTaxonomyName(selection.subtopic) === 'geral' && !selection.subsubtopic;
  return {
    examType: selection.examType,
    board: selection.board,
    subject: selection.subject,
    topic: selection.topic,
    ...(isGeneralSubtopic ? { subtopic: null } : selection.subtopic ? { subtopic: selection.subtopic } : {}),
    ...(selection.subsubtopic ? { subsubtopic: selection.subsubtopic } : {}),
  };
}

export function buildMonitorTopicName(selection: Pick<NormalizedQuestionBankSelection, 'topic' | 'subtopic' | 'subsubtopic'>): string {
  return [selection.topic, selection.subtopic, selection.subsubtopic].filter(Boolean).join(' > ');
}

export function normalizeTaxonomyName(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? '';
}

export function buildMonitorTopicHierarchy(topics: MonitorTopicHierarchyInput[]): MonitorTopicHierarchyNode[] {
  const nodes = new Map<string, MonitorTopicHierarchyNode>();

  for (const topic of topics) {
    const parts = topic.name.split('>').map((part) => part.trim()).filter(Boolean);
    const rootName = parts[0] ?? topic.name.trim();
    const rootKey = normalizeTaxonomyName(rootName);
    if (!rootKey) continue;

    if (!nodes.has(rootKey)) {
      nodes.set(rootKey, { name: rootName, definition: topic.definition?.trim() || null, position: nodes.size, subtopics: [] });
    }
    const root = nodes.get(rootKey)!;
    if (!root.definition && topic.definition?.trim()) root.definition = topic.definition.trim();

    if (parts.length < 2) continue;
    const subtopicName = parts[1]!;
    const subtopicKey = normalizeTaxonomyName(subtopicName);
    let subtopic = root.subtopics.find((candidate) => normalizeTaxonomyName(candidate.name) === subtopicKey);
    if (!subtopic) {
      subtopic = { name: subtopicName, position: root.subtopics.length, subsubtopics: [] };
      root.subtopics.push(subtopic);
    }

    if (parts.length < 3) continue;
    const subsubtopicName = parts.slice(2).join(' > ');
    if (!subtopic.subsubtopics.some((candidate) => normalizeTaxonomyName(candidate.name) === normalizeTaxonomyName(subsubtopicName))) {
      subtopic.subsubtopics.push({ name: subsubtopicName, position: subtopic.subsubtopics.length });
    }
  }

  return Array.from(nodes.values()).map((node, position) => ({
    ...node,
    subtopics: node.subtopics.map((subtopic, subtopicPosition) => ({
      ...subtopic,
      position: subtopicPosition,
      subsubtopics: subtopic.subsubtopics.map((subsubtopic, subsubtopicPosition) => ({
        ...subsubtopic,
        position: subsubtopicPosition,
      })),
    })),
    position,
  }));
}
