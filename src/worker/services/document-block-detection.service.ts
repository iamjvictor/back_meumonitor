import { prisma } from '../../lib/prisma.js';
import { replaceDocumentBlocks, type DocumentBlockInput } from '../../repositories/document-block.repository.js';

type BlockType = DocumentBlockInput['type'];
type DetectionMethod = DocumentBlockInput['detectionMethod'];
type ParserState = 'IDLE' | 'IN_CONTENT' | 'IN_QUESTION' | 'IN_ANSWER_KEY' | 'IN_SOLUTION';

export type StructuralPage = {
  pageNumber: number;
  rawContent: string;
  normalizedContent: string | null;
};

type DocumentElementType =
  | 'HEADING'
  | 'PARAGRAPH'
  | 'QUESTION_START_CANDIDATE'
  | 'ALTERNATIVE'
  | 'FORMULA'
  | 'ANSWER_KEY_START'
  | 'ANSWER_KEY_ITEM'
  | 'SOLUTION_MARKER'
  | 'TABLE_OF_CONTENTS'
  | 'UNKNOWN';

type DocumentElement = {
  type: DocumentElementType;
  text: string;
  pageNumber: number;
  charStart: number;
  charEnd: number;
};

type BlockCandidateType = 'QUESTION_START' | 'ANSWER_KEY_START' | 'SECTION_START' | 'SOLUTION_START';

type BlockCandidate = {
  type: BlockCandidateType;
  text: string;
  pageNumber: number;
  questionNumber?: string;
  confidence: number;
};

type DraftBlock = {
  type: BlockType;
  title: string | null;
  questionNumber: string | null;
  institution: string | null;
  examYear: number | null;
  detectionMethod: DetectionMethod;
  confidence: number;
  parentBlockIndex: number | null;
  sectionPath: string[];
  parts: DocumentElement[];
};

type SectionContext = { level: number; blockIndex: number; title: string };

const QUESTION_START = /^(?:quest[aã]o\s*)?(\d{1,3})[.)]\s*(?:\(([^)\n]{2,100})\))?\s*(.*)$/i;
const NUMBERED_SECTION = /^(\d+(?:\.\d+)*)(?:\s+|[-:])(.+)$/;
const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;
const ALTERNATIVE = /^(?:(?:[A-Ea-e][.)])|(?:\([A-Ea-e]\))|[ⒶⒷⒸⒹⒺ]|(?:\(?[1-5]\)?[.)]))\s+.+/;
const ANSWER_VALUE = '(?:\\[?[A-H]\\]?|\\(?[1-5]\\)?|r?\\$?\\s*[\\d.,]+%?)';
const ANSWER_KEY_ITEM = new RegExp(`^(\\d{1,3})\\s*[.)-]\\s*${ANSWER_VALUE}\\s*$`, 'i');
const ANSWER_KEY_ENTRY = new RegExp(`(?:^|\\s)\\d{1,3}\\s*[.)-]\\s*${ANSWER_VALUE}(?=\\s|$)`, 'gim');
const LOOSE_ANSWER_KEY_ENTRY = new RegExp(`(?:^|\\s)\\d{1,3}\\s*[.)]\\s*${ANSWER_VALUE}`, 'gim');
const SOLUTION_MARKER = /^(?:(?:quest[aã]o\s*)?(\d{1,3})[.)]\s*)?(?:resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b/i;

function isTableOfContentsLine(line: string) {
  return /^(?:sum[aá]rio|conte[uú]do)\b/i.test(line)
    || /(?:(?:\.\s*){3,}|…{2,})\s*\d{1,4}\s*$/.test(line);
}

function isAnswerKeySection(path: string[]) {
  return path.some((section) => /^(?:gabarito|respostas?|key|alternativas?\s+corretas?)\b/i.test(section.trim()));
}

function isFormulaLine(line: string) {
  const words = line.match(/[A-Za-zÀ-ÿ]{3,}/g)?.length ?? 0;
  const symbols = line.match(/[=+*/^%]|\d/g)?.length ?? 0;
  return words < 3 && symbols >= 3;
}

function headingForLine(line: string): { type: BlockType; level: number; title: string } | null {
  const numbered = line.match(NUMBERED_SECTION);
  const title = (numbered?.[2] ?? '').trim();
  // A numeric prefix by itself is not a heading. PDF extraction commonly
  // produces lines such as "2 h 30 min" or "1 pessoas..." mid-question.
  const isHierarchicalNumber = Boolean(numbered?.[1]?.includes('.'));
  const isTitleCase = /^[A-ZÀ-Ý]/.test(title);
  const hasSectionKeyword = /^(?:cap[ií]tulo|unidade|m[oó]dulo|se[cç][aã]o|parte|t[oó]pico)/i.test(title);
  const looksLikeSentence = /[?.!]$/.test(title) || /\b(?:[a-zà-ÿ]{3,}\s+){5,}/.test(title);
  if (numbered && (isHierarchicalNumber || isTitleCase || hasSectionKeyword) && !looksLikeSentence) {
    const level = (numbered[1] ?? '').split('.').length;
    return { type: level > 1 ? 'SUBSECTION' : 'SECTION', level, title: (numbered[2] ?? '').trim() };
  }
  if (/^(cap[ií]tulo|unidade|m[oó]dulo|se[cç][aã]o)\b/i.test(line)) return { type: 'SECTION', level: 1, title: line };
  return null;
}

function didacticTypeForLine(line: string): BlockType | null {
  if (/^(defini[cç][aã]o|conceito)\b/i.test(line)) return 'DEFINITION';
  if (/^(exemplo|exerc[ií]cio|aplica[cç][aã]o)\b/i.test(line)) return 'EXAMPLE';
  if (/^(f[oó]rmula|propriedade|teorema|regra)\b/i.test(line)) return 'FORMULA';
  if (/^(aten[cç][aã]o|observa[cç][aã]o|importante)\b/i.test(line)) return 'THEORY';
  if (/^(tabela|quadro)\b/i.test(line)) return 'TABLE';
  if (/^(passos?|etapas?|itens?)\b/i.test(line)) return 'LIST';
  return null;
}

function startsWithQuestionStatement(text: string) {
  const match = text.match(QUESTION_START);
  const statement = match?.[3]?.trim() ?? '';
  return /^[A-Za-zÀ-ÿ]{2,}\b/.test(statement);
}

function looksLikeInstructionalList(candidate: BlockCandidate, nextElements: DocumentElement[]) {
  const context = [candidate.text, ...nextElements.slice(0, 4).map((element) => element.text)].join(' ');
  const instructions = context.match(/\b\d{1,2}\)\s*para\s+(?:calcular|aumentar|diminuir|determinar|encontrar|obter)\b/gi) ?? [];
  return instructions.length >= 2;
}

function classifyLine(text: string): DocumentElementType {
  if (isTableOfContentsLine(text)) return 'TABLE_OF_CONTENTS';
  if (/^(gabarito|respostas?)\s*[:\-]?\s*$/i.test(text)) return 'ANSWER_KEY_START';
  if (SOLUTION_MARKER.test(text)) return 'SOLUTION_MARKER';
  const answerEntries = answerKeyItemCount(text);
  // A regular paragraph can contain several numeric references. Treat it as a
  // key entry only when the answer notation is dense relative to the line.
  if (ANSWER_KEY_ITEM.test(text)) return 'ANSWER_KEY_ITEM';
  if (QUESTION_START.test(text) && !/^\d+\.\d+/.test(text) && startsWithQuestionStatement(text)) return 'QUESTION_START_CANDIDATE';
  if (answerEntries >= 3 && text.length <= answerEntries * 48) return 'ANSWER_KEY_ITEM';
  if (ALTERNATIVE.test(text)) return 'ALTERNATIVE';
  if (QUESTION_START.test(text) && !/^\d+\.\d+/.test(text)) return 'QUESTION_START_CANDIDATE';
  if (headingForLine(text)) return 'HEADING';
  if (isFormulaLine(text)) return 'FORMULA';
  return didacticTypeForLine(text) ? 'HEADING' : 'PARAGRAPH';
}

function isHeaderOrFooterLine(line: string) {
  const compact = line.trim();
  if (/^\d{1,3}$/.test(compact)) return true;
  if (/^(?:c[aá]ssio\s+vidigal|ifmg\s*[–-]?\s*campus\s+ouro\s+preto)$/i.test(compact)) return true;
  return /^raz[aã]o,?\s+propor[cç][aã]o,?\s+regras?\s+de\s+tr[eê]s(?:\s+e\s+porcentagem)?$/i.test(compact);
}

function stripInlineHeadersFooters(line: string) {
  return line
    .replace(/(?:matem[aá]tica\s+financeira\s*\d*\s*)?raz[aã]o,?\s+propor[cç][aã]o,?\s+regras?\s+de\s+tr[eê]s\s+e\s+porcentagem\s+c[aá]ssio\s+vidigal\s*\d*\s*ifmg\s*[–-]\s*campus\s+ouro\s+preto\s*/gi, '')
    .replace(/c[aá]ssio\s+vidigal\s*\d+\s*ifmg\s*[–-]\s*campus\s+ouro\s+preto\s*/gi, '');
}

function createElements(pages: StructuralPage[]) {
  const elements: DocumentElement[] = [];
  let documentOffset = 0;

  for (const page of pages) {
    const content = page.normalizedContent?.trim() ?? '';
    let pageOffset = 0;
    for (const rawLine of content.split('\n')) {
      const cleanedLine = stripInlineHeadersFooters(rawLine);
      // PDF extraction often keeps "40) ... Resolução" on one visual line.
      // Split the structural marker before classification so it can close an
      // answer key instead of becoming part of its final entry.
      const segments = cleanedLine.split(/(?=(?:(?:quest[aã]o\s*)?\d{1,3}[.)]\s*)?(?:resolu[cç][aã]o|solu[cç][aã]o|coment[aá]rio)\b)/i);
      let segmentOffset = 0;
      for (const segment of segments) {
        const text = segment.trim();
        const lineStart = documentOffset + pageOffset + segmentOffset + segment.indexOf(text);
        const lineEnd = lineStart + text.length;
        if (text && !isHeaderOrFooterLine(text)) {
          elements.push({ type: classifyLine(text), text, pageNumber: page.pageNumber, charStart: lineStart, charEnd: lineEnd });
        }
        segmentOffset += segment.length;
      }
      pageOffset += rawLine.length + 1;
    }
    documentOffset += content.length + 2;
  }
  return elements;
}

function questionMetadata(line: string) {
  const match = line.match(QUESTION_START);
  if (!match) return null;
  const year = line.match(YEAR_PATTERN);
  return {
    questionNumber: match[1] ?? null,
    institution: match[2]?.trim() || null,
    examYear: year ? Number(year[1]) : null,
  };
}

function solutionMetadata(line: string) {
  const match = line.match(SOLUTION_MARKER);
  return { questionNumber: match?.[1] ?? null };
}

function candidateFrom(element: DocumentElement, type: BlockCandidateType, confidence: number): BlockCandidate {
  const metadata = type === 'QUESTION_START' ? questionMetadata(element.text) : null;
  return { type, text: element.text, pageNumber: element.pageNumber, questionNumber: metadata?.questionNumber ?? undefined, confidence };
}

function answerKeyItemCount(text: string) {
  return Array.from(text.matchAll(ANSWER_KEY_ENTRY)).length;
}

function looksLikeAnswerKeyItem(candidate: BlockCandidate, nextElements: DocumentElement[]) {
  if (ANSWER_KEY_ITEM.test(candidate.text)) return true;
  const nearby = [candidate.text, ...nextElements.slice(0, 3).map((element) => element.text)];
  return nearby.length >= 3 && nearby.every((line) => ANSWER_KEY_ITEM.test(line.trim()));
}

function hasMinimumQuestionStatement(candidate: BlockCandidate, nextElements: DocumentElement[]) {
  const match = candidate.text.match(QUESTION_START);
  const statement = match?.[3]?.trim() ?? '';
  const continuation = nextElements
    .filter((element) => element.pageNumber === candidate.pageNumber)
    .slice(0, 2)
    .map((element) => element.text)
    .join(' ');
  const combined = `${statement} ${continuation}`.trim();
  if (combined.length < 40) return false;
  if (/^\d{1,4}\s*(?:[a-z]+|%)?$/i.test(statement)) return false;
  return (combined.match(/[A-Za-zÀ-ÿ]{2,}/g)?.length ?? 0) >= 6;
}

function canOpenQuestion(
  candidate: BlockCandidate,
  context: { nextElements: DocumentElement[]; sectionPath: string[]; state: ParserState },
) {
  if (context.state === 'IN_ANSWER_KEY') return false;
  if (looksLikeAnswerKeyItem(candidate, context.nextElements)) return false;
  if (looksLikeInstructionalList(candidate, context.nextElements)) return false;
  if (!hasMinimumQuestionStatement(candidate, context.nextElements)) return false;

  const match = candidate.text.match(QUESTION_START);
  const localText = [candidate.text, ...context.nextElements.slice(0, 6).map((element) => element.text)].join(' ');
  const sectionSuggestsExercises = context.sectionPath.some((section) => /exerc[ií]cio|quest[aã]o|atividade|lista|prova|simulado/i.test(section));
  const hasQuestionSignal = /\?|\b(?:calcule|calcular|determine|encontre|resolva|assinale|marque|indique|qual|quanto|julgue|escreva|fa[cç]a|em\s+quantos?)\b/i.test(localText);
  const hasAlternativesNearby = context.nextElements.slice(0, 6).some((element) => element.type === 'ALTERNATIVE');
  const hasInstitution = Boolean(match?.[2]);
  const hasQuestionMarker = /^\s*(?:quest[aã]o\s*)?\d{1,3}[.)]/i.test(candidate.text);

  return hasQuestionMarker && (sectionSuggestsExercises || hasQuestionSignal || hasAlternativesNearby || hasInstitution);
}

function isValidatedQuestionStart(elements: DocumentElement[], index: number, state: ParserState, sectionPath: string[]) {
  const element = elements[index];
  return Boolean(element && element.type === 'QUESTION_START_CANDIDATE'
    && canOpenQuestion(candidateFrom(element, 'QUESTION_START', 0.9), {
      nextElements: elements.slice(index + 1),
      sectionPath,
      state,
    }));
}

function canOpenAnswerKey(candidate: BlockCandidate, nextElements: DocumentElement[]) {
  if (/[=·]/.test(candidate.text)) return false;
  if (/^(?:gabarito|respostas?|key|alternativas?\s+corretas?)\s*[:\-]?\s*$/i.test(candidate.text)) return true;
  const entries = [candidate.text, ...nextElements.slice(0, 5).map((element) => element.text)]
    .reduce((count, line) => count + answerKeyItemCount(line), 0);
  return entries >= 3;
}

function startsAnswerKeyCluster(elements: DocumentElement[], index: number) {
  const element = elements[index];
  if (!element || element.type !== 'ANSWER_KEY_ITEM') return false;
  return canOpenAnswerKey(candidateFrom(element, 'ANSWER_KEY_START', 0.9), elements.slice(index + 1));
}

function isDenseAnswerKeyLine(line: string) {
  const compact = line.trim().replace(/^(?:gabarito|respostas?|key|alternativas?\s+corretas?)\s*[:\-]?\s*/i, '');
  const entries = answerKeyItemCount(compact);
  return ANSWER_KEY_ITEM.test(compact) || (entries >= 2 && compact.length <= entries * 48);
}

function isPlausibleAnswerKeyContent(content: string) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const hasExplicitTitle = lines.some((line) => /^(?:gabarito|respostas?|key|alternativas?\s+corretas?)\b/i.test(line));
  // Some educational answer keys include short textual answers, not just a
  // letter or number. An explicit title plus a broad numbered sequence is a
  // stronger signal than the individual-line heuristic in that case.
  if (hasExplicitTitle && /\b\d{1,3}[.)]/.test(content)) return true;
  if (Array.from(content.matchAll(LOOSE_ANSWER_KEY_ENTRY)).length >= 8) return true;
  const answerLines = lines.filter((line) => !/^(?:gabarito|respostas?|key|alternativas?\s+corretas?)\s*[:\-]?\s*$/i.test(line));
  return answerLines.length > 0 && answerLines.every(isDenseAnswerKeyLine);
}

function shouldCloseAnswerKey(
  element: DocumentElement,
  context: { elements: DocumentElement[]; index: number; sectionPath: string[] },
) {
  if (headingForLine(element.text)) return true;
  if (element.type === 'SOLUTION_MARKER') return true;
  if (element.type === 'QUESTION_START_CANDIDATE') {
    return isValidatedQuestionStart(context.elements, context.index, 'IN_CONTENT', context.sectionPath);
  }
  if (element.type === 'PARAGRAPH' && element.text.length > 120 && answerKeyItemCount(element.text) === 0) return true;
  return false;
}

function structuralValidity(type: BlockType, content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (type === 'QUESTION') {
    const statement = compact.replace(/^(?:quest[aã]o\s*)?\d{1,3}[.)]\s*/i, '');
    const words = statement.match(/[A-Za-zÀ-ÿ]{2,}/g)?.length ?? 0;
    if (statement.length < 40 || words < 4) return { isComplete: false, reason: 'QUESTION_STATEMENT_TOO_SHORT' };
    if (ANSWER_KEY_ITEM.test(compact)) return { isComplete: false, reason: 'QUESTION_IS_ANSWER_KEY_ITEM' };
    const hasQuestionContext = /\?|\b(?:assinale|indique|marque|escolha|qual|quanto|quantos|a\s+alternativa\s+correta|podemos\s+afirmar)\b/i.test(statement)
      || /\((?:enem|uerj|vunesp|fgv|cesgranrio|puc|uf|unesp|unicamp|obmep|esaf)/i.test(statement)
      || /^\d{1,3}[.)]\s/.test(compact);
    if (!hasQuestionContext && statement.length < 80) return { isComplete: false, reason: 'QUESTION_WITHOUT_CONTEXT' };
  }
  if (type === 'ANSWER_KEY' && !isPlausibleAnswerKeyContent(content)) {
    return { isComplete: false, reason: 'ANSWER_KEY_CONTAINS_NON_ANSWER_CONTENT' };
  }
  if (!compact) return { isComplete: false, reason: 'EMPTY_BLOCK' };
  return { isComplete: true, reason: null };
}

function contentFrom(parts: DocumentElement[]) {
  return parts.map((part) => part.text).join('\n').trim();
}

export function assembleStructuralBlocks(documentId: string, documentTextId: string, pages: StructuralPage[]): DocumentBlockInput[] {
  const elements = createElements(pages);
  const blocks: DocumentBlockInput[] = [];
  const sectionStack: SectionContext[] = [];
  let current: DraftBlock | null = null;
  let state: ParserState = 'IDLE';

  const sectionPath = () => sectionStack.map((section) => section.title);
  const parentBlockIndex = () => sectionStack.at(-1)?.blockIndex ?? null;
  const flush = () => {
    if (!current || current.parts.length === 0) return;
    const normalizedContent = contentFrom(current.parts);
    const first = current.parts[0]!;
    const last = current.parts.at(-1)!;
    const validity = structuralValidity(current.type, normalizedContent);
    blocks.push({
      documentId,
      documentTextId,
      parentBlockId: current.parentBlockIndex === null ? null : String(current.parentBlockIndex),
      blockIndex: blocks.length,
      type: current.type,
      title: current.title,
      rawContent: normalizedContent,
      normalizedContent,
      sectionPath: current.sectionPath,
      questionNumber: current.questionNumber,
      institution: current.institution,
      examYear: current.examYear,
      pageStart: first.pageNumber,
      pageEnd: last.pageNumber,
      charStart: first.charStart,
      charEnd: last.charEnd,
      detectionMethod: current.detectionMethod,
      confidence: validity.isComplete ? current.confidence : Math.min(current.confidence, 0.6),
      status: validity.isComplete ? 'READY' : 'NEEDS_REVIEW',
      isComplete: validity.isComplete,
      incompleteReason: validity.reason,
    });
    current = null;
  };
  const open = (type: BlockType, element: DocumentElement, options: Partial<DraftBlock> = {}) => {
    current = {
      type,
      title: options.title ?? null,
      questionNumber: options.questionNumber ?? null,
      institution: options.institution ?? null,
      examYear: options.examYear ?? null,
      detectionMethod: options.detectionMethod ?? 'HEURISTIC',
      confidence: options.confidence ?? 0.82,
      parentBlockIndex: parentBlockIndex(),
      sectionPath: sectionPath(),
      parts: [element],
    };
  };
  const append = (element: DocumentElement) => {
    if (!current) open('THEORY', element, { confidence: 0.7 });
    else current.parts.push(element);
  };

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.type === 'TABLE_OF_CONTENTS') continue;

    // An answer key is a dense sequence of short entries. As soon as a strong
    // structural signal appears, close it and process that signal normally.
    if (state === 'IN_ANSWER_KEY' && shouldCloseAnswerKey(element, { elements, index, sectionPath: sectionPath() })) {
      flush();
      state = 'IN_CONTENT';
    }

    const heading = headingForLine(element.text);
    if (heading) {
      flush();
      while (sectionStack.length > 0 && sectionStack.at(-1)!.level >= heading.level) sectionStack.pop();
      const path = [...sectionPath(), heading.title];
      blocks.push({
        documentId, documentTextId, parentBlockId: parentBlockIndex() === null ? null : String(parentBlockIndex()),
        blockIndex: blocks.length, type: heading.type, title: heading.title, rawContent: heading.title,
        normalizedContent: heading.title, sectionPath: path, questionNumber: null, institution: null, examYear: null,
        pageStart: element.pageNumber, pageEnd: element.pageNumber, charStart: element.charStart, charEnd: element.charEnd,
        detectionMethod: 'REGEX', confidence: 0.95, status: 'READY', isComplete: true, incompleteReason: null,
      });
      sectionStack.push({ level: heading.level, blockIndex: blocks.length - 1, title: heading.title });
      state = 'IDLE';
      continue;
    }

    if (element.type === 'ANSWER_KEY_START') {
      const candidate = candidateFrom(element, 'ANSWER_KEY_START', 0.95);
      if (canOpenAnswerKey(candidate, elements.slice(index + 1))) {
        flush();
        open('ANSWER_KEY', element, { title: element.text, detectionMethod: 'REGEX', confidence: candidate.confidence });
        state = 'IN_ANSWER_KEY';
        continue;
      }
    }
    if (state !== 'IN_ANSWER_KEY' && isAnswerKeySection(sectionPath())) {
      flush();
      open('ANSWER_KEY', element, { detectionMethod: 'HEURISTIC', confidence: 0.95 });
      state = 'IN_ANSWER_KEY';
      continue;
    }
    if (element.type === 'SOLUTION_MARKER') {
      const metadata = solutionMetadata(element.text);
      const currentBlock = current as DraftBlock | null;
      const precedingQuestionNumber = currentBlock?.type === 'QUESTION' ? currentBlock.questionNumber : null;
      flush();
      open('SOLUTION', element, {
        title: element.text,
        questionNumber: metadata.questionNumber ?? precedingQuestionNumber,
        detectionMethod: 'REGEX',
        confidence: 0.95,
      });
      state = 'IN_SOLUTION';
      continue;
    }
    if (element.type === 'QUESTION_START_CANDIDATE' && looksLikeInstructionalList(candidateFrom(element, 'QUESTION_START', 0.85), elements.slice(index + 1))) {
      flush();
      open('THEORY', element, { detectionMethod: 'HEURISTIC', confidence: 0.85 });
      state = 'IN_CONTENT';
      continue;
    }
    if (isValidatedQuestionStart(elements, index, state, sectionPath())) {
      flush();
      const metadata = questionMetadata(element.text);
      open('QUESTION', element, { title: element.text, questionNumber: metadata?.questionNumber ?? null, institution: metadata?.institution ?? null, examYear: metadata?.examYear ?? null, detectionMethod: 'REGEX', confidence: 0.9 });
      state = 'IN_QUESTION';
      continue;
    }
    if (startsAnswerKeyCluster(elements, index) && state !== 'IN_ANSWER_KEY') {
      flush();
      open('ANSWER_KEY', element, { detectionMethod: 'HEURISTIC', confidence: 0.9 });
      state = 'IN_ANSWER_KEY';
      continue;
    }
    if (element.type === 'ANSWER_KEY_ITEM' && state === 'IN_ANSWER_KEY') {
      append(element);
      continue;
    }
    if (element.type === 'HEADING') {
      const didacticType = didacticTypeForLine(element.text);
      if (didacticType) {
        flush();
        open(didacticType, element, { title: element.text, detectionMethod: 'HEURISTIC', confidence: 0.85 });
        state = 'IN_CONTENT';
        continue;
      }
    }
    append(element);
    if (state === 'IDLE') state = 'IN_CONTENT';
  }
  flush();
  return blocks;
}

export class DocumentBlockDetectionService {
  async process(documentId: string, documentTextId: string) {
    const startedAt = Date.now();
    console.log('Deteccao estrutural iniciada', { event: 'monitor.document_blocks_detection_started', documentId, documentTextId });
    const source = await prisma.documentText.findUnique({
      where: { id: documentTextId },
      select: {
        documentId: true,
        pages: { select: { pageNumber: true, rawContent: true, normalizedContent: true }, orderBy: { pageNumber: 'asc' } },
      },
    });
    if (!source || source.documentId !== documentId) throw new Error('Texto de origem nao encontrado para deteccao estrutural.');

    const blocks = assembleStructuralBlocks(documentId, documentTextId, source.pages);
    const result = await replaceDocumentBlocks(documentTextId, blocks);
    const typeCounts = blocks.reduce<Record<string, number>>((counts, block) => ({ ...counts, [block.type]: (counts[block.type] || 0) + 1 }), {});
    console.log('Deteccao estrutural concluida', {
      event: 'monitor.document_blocks_detection_completed', documentId, documentTextId, blockCount: result.blockCount,
      typeCounts, reviewCount: blocks.filter((block) => block.status === 'NEEDS_REVIEW').length, durationMs: Date.now() - startedAt,
    });
    return { ...result, typeCounts };
  }
}
