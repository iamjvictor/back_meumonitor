import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';
import {
  buildEmbeddingContent,
  getBlockEligibility,
  getChunkEligibility,
  splitBlockContent,
  type BlockForChunking,
} from '../worker/services/chunk.service.js';
import { assembleStructuralBlocks } from '../worker/services/document-block-detection.service.js';
import { findRepeatedPageLines, TextNormalizationService } from '../worker/services/text-normalization.service.js';
import {
  extractQuestionsFromBlocks,
  type ExtractionChunk,
} from '../worker/services/question-extraction.service.js';
import { QuestionCompletionService } from '../worker/services/completeQuestion/question-completion.service.js';
import { QuestionCompletionRequestService } from '../worker/services/completeQuestion/question-completion-request.service.js';
import type { StructuredRequestUsage } from '../worker/client/openrouter.client.js';
import { QuestionQualityReviewAgentService } from '../worker/services/completeQuestion/question-quality-review-agent.service.js';
import { QuestionSourceReconstructionAgentService } from '../worker/services/completeQuestion/question-source-reconstruction-agent.service.js';
import {
  resolveDocumentTestCorpusDirectory,
  resolveDocumentTestResultsDirectory,
} from './document-test-paths.js';
import { extractPdfPagesWithLayout, type LayoutPage } from '../worker/services/pdf-layout-extraction.service.js';
import { assessQuestionQuality, normalizedQuestionKey, validateQuestionStructure } from '../worker/services/question-quality.service.js';
import { buildQuestionSourceEvidence } from '../worker/services/question-source-context.service.js';

type OfflinePage = { pageNumber: number; rawContent: string; normalizedContent: string };
type SimulatedBlock = BlockForChunking & {
  id: string;
  blockIndex: number;
  charStart: number;
  charEnd: number;
  questionNumber: string | null;
  institution: string | null;
  examYear: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  topicLinks: [];
};

function projectRoot() {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)));
}

function compact(value: string | null | undefined, maxLength = 500) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function markdown(value: unknown) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function elapsed(start: number) {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function parsePdf(filePath: string): Promise<{ total: number; pages: LayoutPage[] }> {
  const pages = await extractPdfPagesWithLayout(new Uint8Array(await readFile(filePath)));
  return { total: pages.length, pages };
}

function createPages(pageTexts: Array<{ num: number; text: string }>): OfflinePage[] {
  const normalizer = new TextNormalizationService();
  const repeatedPageLines = findRepeatedPageLines(pageTexts.map((page) => page.text));
  return pageTexts.map((page) => ({
    pageNumber: page.num,
    rawContent: page.text,
    normalizedContent: normalizer.normalize(page.text, { repeatedPageLines }).normalizedContent,
  }));
}

function createBlocks(pages: OfflinePage[]): SimulatedBlock[] {
  return assembleStructuralBlocks(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    pages,
  ).map((block) => ({
    ...block,
    title: block.title ?? null,
    isComplete: block.isComplete ?? true,
    incompleteReason: block.incompleteReason ?? null,
    id: `block-${block.blockIndex + 1}`,
    topicLinks: [],
    questionNumber: block.questionNumber ?? null,
    institution: block.institution ?? null,
    examYear: block.examYear ?? null,
    pageStart: block.pageStart ?? null,
    pageEnd: block.pageEnd ?? null,
    charStart: block.charStart,
    charEnd: block.charEnd,
  }));
}

function createChunks(filePath: string, blocks: SimulatedBlock[]) {
  const chunks: ExtractionChunk[] = [];
  const skipped: Array<{ blockId: string; type: string; reason: string; content: string }> = [];
  for (const block of blocks) {
    const blockEligibility = getBlockEligibility(block);
    if (!blockEligibility.eligible) {
      skipped.push({ blockId: block.id, type: block.type, reason: blockEligibility.reason, content: block.normalizedContent });
      continue;
    }
    let chunkIndexInBlock = 0;
    for (const slice of splitBlockContent(block.normalizedContent, block.type)) {
      const chunkEligibility = getChunkEligibility(slice, block);
      if (!chunkEligibility.eligible) {
        skipped.push({ blockId: block.id, type: block.type, reason: chunkEligibility.reason, content: slice.content });
        continue;
      }
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        documentId: 'offline-document',
        chunkIndex: chunks.length,
        blockId: block.id,
        content: slice.content,
        charStart: block.charStart,
        charEnd: block.charEnd,
        block: { pageStart: block.pageStart, pageEnd: block.pageEnd },
      });
      chunkIndexInBlock += 1;
    }
  }
  void filePath;
  return { chunks, skipped };
}

async function completeCandidate(
  candidate: ReturnType<typeof extractQuestionsFromBlocks>[number],
  chunks: ExtractionChunk[],
  completionService: QuestionCompletionService,
  reviewService: QuestionQualityReviewAgentService,
  reconstructionService: QuestionSourceReconstructionAgentService,
) {
  const sourceChunks = chunks.filter((chunk) => candidate.sourceChunkIndexes.includes(chunk.chunkIndex));
  let candidateForProcessing = candidate;
  let sourceStructure = validateQuestionStructure({ text: candidate.text, alternatives: candidate.alternatives });
  let reconstruction: Awaited<ReturnType<QuestionSourceReconstructionAgentService['reconstruct']>> | null = null;
  if (sourceStructure.processingState === 'STRUCTURALLY_INVALID') {
    reconstruction = await reconstructionService.reconstruct({
      questionNumber: candidate.questionNumber ?? null,
      statement: candidate.text,
      alternatives: candidate.alternatives,
      correctAnswer: candidate.correctAnswer,
      explanation: candidate.explanation,
      sourceEvidence: buildQuestionSourceEvidence(candidate.text, sourceChunks, chunks),
      convertToMultipleChoice: sourceStructure.reasons.includes('MULTIPLE_QUESTIONS')
        || candidate.alternatives.length === 0,
    });
    if (reconstruction.changed && reconstruction.confidence >= 0.7 && reconstruction.recommendedAction !== 'REPROCESS') {
      candidateForProcessing = {
        ...candidate,
        ...(reconstruction.changes.changedFields.includes('statement') && reconstruction.changes.statement
          ? { text: reconstruction.changes.statement }
          : {}),
        ...(reconstruction.changes.changedFields.includes('alternatives') && reconstruction.changes.alternatives
          ? { alternatives: reconstruction.changes.alternatives }
          : {}),
        ...(reconstruction.changes.changedFields.includes('correctAnswer')
          ? { correctAnswer: reconstruction.changes.correctAnswer }
          : {}),
        ...(reconstruction.changes.changedFields.includes('explanation')
          ? { explanation: reconstruction.changes.explanation }
          : {}),
      };
      sourceStructure = validateQuestionStructure({ text: candidateForProcessing.text, alternatives: candidateForProcessing.alternatives });
    }
  }
  const sourceContext = buildQuestionSourceEvidence(candidateForProcessing.text, sourceChunks, chunks);
  if (sourceStructure.processingState === 'STRUCTURALLY_INVALID') {
    const quality = assessQuestionQuality({
      text: candidateForProcessing.text,
      alternatives: candidateForProcessing.alternatives,
      correctAnswer: candidateForProcessing.correctAnswer,
      explanation: candidateForProcessing.explanation,
      sourceContext,
    });
    return { candidate: candidateForProcessing, sourceChunks, sourceContext, completed: null, quality, sourceStructure, aiReview: null, reconstruction };
  }
  const completed = await completionService.complete({
    documentId: 'offline-document',
    sourceBlockId: candidateForProcessing.sourceBlockId ?? null,
    questionNumber: candidateForProcessing.questionNumber ?? null,
    statement: candidateForProcessing.text,
    alternatives: candidateForProcessing.alternatives,
    correctAnswer: candidateForProcessing.correctAnswer,
    explanation: candidateForProcessing.explanation,
    sourceContext,
    skipDocumentRag: true,
  });
  const quality = assessQuestionQuality({
    text: candidateForProcessing.text,
    alternatives: completed.alternatives,
    correctAnswer: completed.correctAnswer,
    explanation: completed.explanation,
    sourceContext,
    generatedAlternatives: completed.alternativesGenerated,
    generatedCorrectAnswer: completed.answerGenerated,
    generatedExplanation: completed.explanationGenerated,
  });
  const aiReview = await reviewService.review({
    statement: candidateForProcessing.text,
    alternatives: completed.alternatives,
    correctAnswer: completed.correctAnswer,
    explanation: completed.explanation,
    sourceContext,
  });
  if (aiReview.reasons.includes('AI_REVIEW_FAILED')) quality.reasons.push('AI_REVIEW_FAILED');
  if (aiReview.recommendedAction === 'REPROCESS') quality.recommendedAction = 'REPROCESS';
  else if (aiReview.recommendedAction === 'CORRECT' && quality.recommendedAction === 'KEEP') quality.recommendedAction = 'CORRECT';
  quality.score = Math.min(quality.score, aiReview.score);
  quality.severity = aiReview.severity === 'CRITICAL' || quality.severity === 'CRITICAL'
    ? 'CRITICAL'
    : aiReview.severity === 'WARNING' || quality.severity === 'WARNING' ? 'WARNING' : 'INFO';
  return { candidate: candidateForProcessing, sourceChunks, sourceContext, completed, quality, sourceStructure, aiReview, reconstruction };
}

function candidateReport(index: number, result: Awaited<ReturnType<typeof completeCandidate>>) {
  const { candidate, completed, quality, sourceChunks } = result;
  const alternatives = completed?.alternatives.map((alternative) => `${alternative.label}) ${alternative.text}`).join('\n') ?? '';
  return [
    `## Questão ${candidate.questionNumber ?? index + 1}`,
    '',
    `- Bloco: \`${candidate.sourceBlockId ?? 'n/a'}\``,
    `- Chunks: ${sourceChunks.map((chunk) => chunk.chunkIndex).join(', ') || 'n/a'}`,
    `- Tipo final: \`MULTIPLE_CHOICE\``,
    `- Estado estrutural: \`${result.sourceStructure.processingState}\``,
    `- Status do fluxo: \`PENDING_REVIEW\``,
    `- Score: **${quality.score}/100**`,
    `- Severidade: **${quality.severity}**`,
    `- Ação recomendada: **${quality.recommendedAction}**`,
    `- Motivos: ${quality.reasons.join(', ') || 'nenhum'}`,
    `- Revisão semântica IA: ${result.aiReview ? `${result.aiReview.severity}, ${result.aiReview.score}/100, ação ${result.aiReview.recommendedAction}` : 'não executada (bloqueio estrutural)'}`,
    `- Motivos da revisão IA: ${result.aiReview?.reasons.join(', ') || 'nenhum'}`,
    `- Alternativas geradas: ${completed?.alternativesGenerated ? 'sim' : 'não'}`,
    `- Gabarito gerado: ${completed?.answerGenerated ? 'sim' : 'não'}`,
    `- Explicação gerada: ${completed?.explanationGenerated ? 'sim' : 'não'}`,
    `- Reconstrução por IA: ${result.reconstruction ? (result.reconstruction.changed ? `sim (${result.reconstruction.confidence})` : 'executada sem alteração') : 'não necessária'}`,
    `- Evidências da reconstrução: ${result.reconstruction?.evidence.join(' | ') || 'nenhuma'}`,
    '',
    '### Enunciado',
    '',
    candidate.text,
    '',
    '### Alternativas finais',
    '',
    alternatives || '_Nenhuma alternativa disponível._',
    '',
    `**Gabarito:** ${completed?.correctAnswer ?? 'não identificado'}`,
    '',
    '### Explicação final',
    '',
    completed?.explanation ?? '_Nenhuma explicação disponível._',
    '',
  ].join('\n');
}

async function main() {
  const totalStartedAt = performance.now();
  const stageTimes: Record<string, number> = {};
  const llmUsage: Array<StructuredRequestUsage & { task: string }> = [];
  QuestionCompletionRequestService.setUsageObserver((usage) => llmUsage.push(usage));
  const argumentsWithoutFlags = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const inputDirectory = resolve(argumentsWithoutFlags[0] ?? resolveDocumentTestCorpusDirectory(projectRoot()));
  const requestedFile = argumentsWithoutFlags[1];
  const outputDirectory = resolve(argumentsWithoutFlags[2] ?? resolveDocumentTestResultsDirectory(projectRoot()));
  const limitArgument = process.argv.find((argument) => argument.match(/^--limit(?:=|$)/));
  const limitValue = limitArgument?.includes('=')
    ? limitArgument.split('=')[1]
    : process.argv[process.argv.indexOf(limitArgument ?? '') + 1];
  const parsedLimit = limitValue ? Number(limitValue) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : null;
  const fileName = requestedFile ?? (await (await import('node:fs/promises')).readdir(inputDirectory))
    .filter((name) => extname(name).toLowerCase() === '.pdf')
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))[0];
  if (!fileName) throw new Error(`Nenhum PDF encontrado em ${inputDirectory}.`);

  const filePath = resolve(inputDirectory, fileName);
  let stageStartedAt = performance.now();
  const parsed = await parsePdf(filePath);
  stageTimes.pdfExtraction = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const pages = createPages(parsed.pages);
  const blocks = createBlocks(pages);
  const { chunks, skipped } = createChunks(filePath, blocks);
  const questionBlocks = blocks.filter((block) => block.type === 'QUESTION');
  const allCandidates = extractQuestionsFromBlocks(questionBlocks, chunks as never);
  stageTimes.structuralExtraction = elapsed(stageStartedAt);
  const candidates = limit ? allCandidates.slice(0, limit) : allCandidates;
  const completionService = new QuestionCompletionService();
  const reviewService = new QuestionQualityReviewAgentService();
  const reconstructionService = new QuestionSourceReconstructionAgentService();
  const results: Array<Awaited<ReturnType<typeof completeCandidate>>> = [];
  stageStartedAt = performance.now();
  for (const candidate of candidates) {
    const result = await completeCandidate(candidate, chunks, completionService, reviewService, reconstructionService);
    const duplicate = results.some((previous) => normalizedQuestionKey(previous.candidate.text) === normalizedQuestionKey(result.candidate.text));
    if (duplicate) {
      result.quality.reasons.push('DUPLICATE');
      result.quality.recommendedAction = 'DUPLICATE';
      result.quality.severity = 'CRITICAL';
      result.quality.score = Math.min(result.quality.score, 20);
    }
    results.push(result);
  }
  stageTimes.aiProcessing = elapsed(stageStartedAt);

  const qualityCounts = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.quality.recommendedAction] = (counts[result.quality.recommendedAction] ?? 0) + 1;
    return counts;
  }, {});
  const report = [
    `# Dry-run de questões — ${fileName}`,
    '',
    `Gerado em: ${new Date().toISOString()}`,
    `Arquivo: \`${filePath}\``,
    '',
    '> Este relatório foi gerado sem conexão com Prisma, Supabase ou banco de dados. Nenhuma questão foi persistida.',
    '',
    '## Resumo',
    '',
    `- Páginas: ${parsed.total}`,
    `- Blocos: ${blocks.length}`,
    `- Blocos de questão: ${questionBlocks.length}`,
    `- Chunks: ${chunks.length}`,
    `- Candidatas extraídas: ${candidates.length}`,
    `- Candidatas detectadas antes do limite: ${allCandidates.length}`,
    `- Limite aplicado: ${limit ?? 'nenhum'}`,
    `- Questões completadas: ${results.length}`,
    `- Fragmentos/chunks descartados: ${skipped.length}`,
    `- Ações recomendadas: ${Object.entries(qualityCounts).map(([key, value]) => `${key} (${value})`).join(', ') || 'nenhuma'}`,
    '',
    '## Métricas de execução',
    '',
    `- Tempo total: **${elapsed(totalStartedAt)} ms**`,
    `- Extração/layout do PDF: **${stageTimes.pdfExtraction} ms**`,
    `- Extração estrutural e candidatas: **${stageTimes.structuralExtraction} ms**`,
    `- Processamento IA: **${stageTimes.aiProcessing} ms**`,
    `- Chamadas IA: **${llmUsage.length}**`,
    `- Tokens de entrada: **${llmUsage.reduce((sum, item) => sum + item.promptTokens, 0)}**`,
    `- Tokens de saída: **${llmUsage.reduce((sum, item) => sum + item.completionTokens, 0)}**`,
    `- Tokens totais: **${llmUsage.reduce((sum, item) => sum + item.totalTokens, 0)}**`,
    '',
    '### Chamadas IA por etapa',
    '',
    '| Etapa | Modelo | Status | Duração (ms) | Entrada | Saída | Total |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...llmUsage.map((item) => `| ${item.task} | ${item.model} | ${item.statusCode} | ${item.durationMs} | ${item.promptTokens} | ${item.completionTokens} | ${item.totalTokens} |`),
    '',
    '## Questões',
    '',
    ...results.map((result, index) => candidateReport(index, result)),
    '## Blocos de questão sem candidata',
    '',
    ...questionBlocks
      .filter((block) => !candidates.some((candidate) => candidate.sourceBlockId === block.id))
      .map((block) => `- \`${block.id}\` — ${compact(block.normalizedContent, 700)}`),
    '',
    '## Chunks descartados',
    '',
    ...skipped.map((item) => `- \`${item.blockId}\` (${item.type}) — ${item.reason}: ${compact(item.content, 300)}`),
    '',
  ].join('\n');

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `${basename(fileName, extname(fileName))}.dry-run.md`);
  await writeFile(outputPath, report, 'utf8');
  QuestionCompletionRequestService.setUsageObserver(null);
  console.log(JSON.stringify({ outputPath, fileName, pages: parsed.total, blocks: blocks.length, candidates: candidates.length }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
