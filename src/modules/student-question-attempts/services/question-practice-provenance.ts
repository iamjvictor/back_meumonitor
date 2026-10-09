type QuestionBankItemProvenance = {
  imageUrls?: unknown;
  board?: unknown;
  examName?: unknown;
  examYear?: unknown;
  sourceUrl?: unknown;
} | null;

export type QuestionPracticeProvenanceResult = {
  imageUrls: string[];
  provenance: {
    board: string | null;
    examName: string | null;
    examYear: number | null;
    sourceUrl: string | null;
  } | null;
};

export function mapQuestionPracticeProvenance(input: {
  questionBankItem?: QuestionBankItemProvenance;
  metadata?: unknown;
}): QuestionPracticeProvenanceResult {
  const metadata = asRecord(input.metadata);
  const relation = input.questionBankItem;
  const relationImageUrls = normalizeImageUrls(relation?.imageUrls);
  const imageUrls = relationImageUrls.length > 0
    ? relationImageUrls
    : normalizeImageUrls(metadata?.imageUrls);

  const provenance = {
    board: firstText(relation?.board, metadata?.board),
    examName: firstText(relation?.examName, metadata?.examName),
    examYear: firstYear(relation?.examYear, metadata?.examYear),
    sourceUrl: firstText(relation?.sourceUrl, metadata?.sourceUrl),
  };

  const hasProvenance = Object.values(provenance).some((value) => value !== null);
  return { imageUrls, provenance: hasProvenance ? provenance : null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .map((url) => url.trim());
}

function firstText(primary: unknown, fallback: unknown): string | null {
  for (const value of [primary, fallback]) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstYear(primary: unknown, fallback: unknown): number | null {
  for (const value of [primary, fallback]) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}
