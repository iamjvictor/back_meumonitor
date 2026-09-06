export type NormalizationSample = { before: string; after: string };

export type NormalizationRule = {
  rule: string;
  count: number;
  samples: NormalizationSample[];
};

export type NormalizationResult = {
  normalizedContent: string;
  rulesApplied: NormalizationRule[];
  repeatedPageLines: string[];
};

type NormalizationOptions = {
  repeatedPageLines?: string[];
  maxSamplesPerRule?: number;
  maxSampleLength?: number;
};

const DEFAULT_MAX_SAMPLES = 5;
const DEFAULT_MAX_SAMPLE_LENGTH = 160;

function compactSample(value: string, maxLength: number) {
  const compact = value.replace(/\n/g, '\\n');
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function addRule(
  rules: Map<string, NormalizationRule>,
  rule: string,
  before: string,
  after: string,
  maxSamples: number,
  maxSampleLength: number,
) {
  const current = rules.get(rule) ?? { rule, count: 0, samples: [] };
  current.count += 1;
  if (current.samples.length < maxSamples) {
    current.samples.push({
      before: compactSample(before, maxSampleLength),
      after: compactSample(after, maxSampleLength),
    });
  }
  rules.set(rule, current);
}

function normalizedLine(value: string) {
  return value.replace(/[ \t]+/g, ' ').trim();
}

const PREFIXED_DIACRITICS: Record<string, string> = {
  '´': '\u0301',
  '`': '\u0300',
  'ˆ': '\u0302',
  '^': '\u0302',
  '˜': '\u0303',
  '¨': '\u0308',
  '¸': '\u0327',
};

function repairPrefixedDiacritics(
  content: string,
  rules: Map<string, NormalizationRule>,
  maxSamples: number,
  maxSampleLength: number,
) {
  // Alguns extratores de PDF separam o acento da letra por espaço, por
  // exemplo: "constru¸ c˜ ao" em vez de "construção".
  const repaired = content.replace(/([´`ˆ^˜¨¸])[ \t]*([\p{L}])/gu, (match, accent: string, letter: string) => {
    const combiningMark = PREFIXED_DIACRITICS[accent];
    if (!combiningMark || (accent === '¸' && !/[cC]/u.test(letter))) return match;
    if ((accent === 'ˆ' || accent === '^' || accent === '¨') && !/[aAeEiIoOuUÁÀÃÂÉÊÍÓÔÕÚáàãâéêíóôõú]/u.test(letter)) {
      return match;
    }

    const baseLetter = letter === 'ı' ? 'i' : letter;
    const normalized = `${baseLetter}${combiningMark}`.normalize('NFC');
    addRule(rules, 'REPAIR_PREFIXED_DIACRITIC', match, normalized, maxSamples, maxSampleLength);
    return normalized;
  });

  const repairedDotlessI = repaired.replace(/ı([\u0300\u0301\u0302\u0303\u0308])/gu, (match, combiningMark: string) => {
    const normalizedLetter = `i${combiningMark}`.normalize('NFC');
    addRule(rules, 'REPAIR_DOTLESS_I_DIACRITIC', match, normalizedLetter, maxSamples, maxSampleLength);
    return normalizedLetter;
  });
  const normalized = repairedDotlessI.normalize('NFC');
  if (normalized !== repairedDotlessI) {
    addRule(rules, 'NORMALIZE_UNICODE_NFC', repairedDotlessI, normalized, maxSamples, maxSampleLength);
  }
  return normalized;
}

export function findRepeatedPageLines(pages: string[]) {
  const candidates = new Map<string, number>();

  for (const page of pages) {
    const lines = page
      .replace(/\r/g, '')
      .split('\n')
      .map(normalizedLine)
      .filter((line) => line.length >= 4)
      .filter((line) => !/^[-–—]?\s*\d+\s*[-–—]?$/.test(line));
    const pageEdges = [...new Set([
      ...lines.slice(0, 3),
      ...lines.slice(-3),
    ].filter((line): line is string => Boolean(line)))];

    for (const line of pageEdges) {
      candidates.set(line, (candidates.get(line) ?? 0) + 1);
    }
  }

  return [...candidates.entries()]
    .filter(([, count]) => count >= 2)
    .map(([line]) => line);
}

export class TextNormalizationService {
  normalize(text: string, options: NormalizationOptions = {}): NormalizationResult {
    const rules = new Map<string, NormalizationRule>();
    const maxSamples = options.maxSamplesPerRule ?? DEFAULT_MAX_SAMPLES;
    const maxSampleLength = options.maxSampleLength ?? DEFAULT_MAX_SAMPLE_LENGTH;
    const repeatedPageLines = options.repeatedPageLines ?? [];
    let content = text;

    content = repairPrefixedDiacritics(content, rules, maxSamples, maxSampleLength);

    content = content.replace(/\r/g, () => {
      addRule(rules, 'REMOVE_CARRIAGE_RETURN', '\\r', '', maxSamples, maxSampleLength);
      return '';
    });
    content = content.replace(/([\p{L}])-\n(?=[\p{L}])/gu, (match, letter: string) => {
      addRule(rules, 'JOIN_HYPHENATED_LINE_BREAK', match, letter, maxSamples, maxSampleLength);
      return letter;
    });
    content = content.replace(/[ \t]{2,}/g, (match) => {
      addRule(rules, 'COLLAPSE_REPEATED_SPACES', match, ' ', maxSamples, maxSampleLength);
      return ' ';
    });

    if (repeatedPageLines.length > 0) {
      const repeated = new Set(repeatedPageLines);
      content = content.split('\n').filter((line) => {
        if (!repeated.has(normalizedLine(line))) return true;
        addRule(rules, 'REMOVE_REPEATED_PAGE_HEADER_OR_FOOTER', line, '', maxSamples, maxSampleLength);
        return false;
      }).join('\n');
    }

    content = content.replace(/\n{3,}/g, (match) => {
      addRule(rules, 'COLLAPSE_EXCESSIVE_LINE_BREAKS', match, '\n\n', maxSamples, maxSampleLength);
      return '\n\n';
    }).trim();

    return { normalizedContent: content, rulesApplied: [...rules.values()], repeatedPageLines };
  }
}
