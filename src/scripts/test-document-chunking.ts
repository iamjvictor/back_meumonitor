import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';
import { PDFParse } from 'pdf-parse';
import {
  buildEmbeddingContent,
  getBlockEligibility,
  getChunkEligibility,
  splitBlockContent,
  type BlockForChunking,
} from '../worker/services/chunk.service.js';
import { assembleStructuralBlocks } from '../worker/services/document-block-detection.service.js';
import { findRepeatedPageLines, TextNormalizationService } from '../worker/services/text-normalization.service.js';

type OfflinePage = {
  pageNumber: number;
  rawContent: string;
  normalizedContent: string;
};

type SimulatedBlock = BlockForChunking & {
  charStart: number;
  charEnd: number;
};

type SimulatedChunk = {
  id: string;
  blockId: string;
  blockType: string;
  pageStart: number | null;
  pageEnd: number | null;
  chunkIndexInBlock: number;
  content: string;
  embeddingContent: string | null;
  status: 'EMBEDDING_PENDING' | 'READY';
};

function projectRoot() {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)));
}

function compact(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function markdownCell(value: string | number | null) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

function createPages(pageTexts: Array<{ num: number; text: string }>) {
  const normalizer = new TextNormalizationService();
  const repeatedPageLines = findRepeatedPageLines(pageTexts.map((page) => page.text));
  return pageTexts.map((page) => {
    const normalizedContent = normalizer.normalize(page.text, { repeatedPageLines }).normalizedContent;
    return { pageNumber: page.num, rawContent: page.text, normalizedContent };
  });
}

function createSimulatedBlocks(pages: OfflinePage[]) {
  return assembleStructuralBlocks('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', pages)
    .map((block): SimulatedBlock => {
    return {
      id: `block-${block.blockIndex + 1}`,
      blockIndex: block.blockIndex,
      type: block.type,
      title: block.title ?? null,
      normalizedContent: block.normalizedContent,
      isComplete: block.isComplete ?? true,
      incompleteReason: block.incompleteReason ?? null,
      sectionPath: block.sectionPath,
      questionNumber: block.questionNumber ?? null,
      institution: block.institution ?? null,
      examYear: block.examYear ?? null,
      pageStart: block.pageStart ?? null,
      pageEnd: block.pageEnd ?? null,
      topicLinks: [],
      charStart: block.charStart,
      charEnd: block.charEnd,
    };
  });
}

async function parsePdf(filePath: string) {
  const parser = new PDFParse({ data: Buffer.from(await readFile(filePath)) });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}

async function simulateDocument(filePath: string) {
  const parsed = await parsePdf(filePath);
  const pages = createPages(parsed.pages);
  const blocks = createSimulatedBlocks(pages);
  const chunks: SimulatedChunk[] = [];
  const skipped: Array<{ block: SimulatedBlock; reason: string; content: string }> = [];

  for (const block of blocks) {
    const blockEligibility = getBlockEligibility(block);
    if (!blockEligibility.eligible) {
      skipped.push({ block, reason: blockEligibility.reason, content: block.normalizedContent });
      continue;
    }

    let chunkIndexInBlock = 0;
    for (const slice of splitBlockContent(block.normalizedContent, block.type)) {
      const chunkEligibility = getChunkEligibility(slice, block);
      if (!chunkEligibility.eligible) {
        skipped.push({ block, reason: chunkEligibility.reason, content: slice.content });
        continue;
      }

      const isAnswerKey = block.type === 'ANSWER_KEY';
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        blockId: block.id,
        blockType: block.type,
        pageStart: block.pageStart,
        pageEnd: block.pageEnd,
        chunkIndexInBlock,
        content: slice.content,
        embeddingContent: isAnswerKey
          ? null
          : buildEmbeddingContent(block, slice.content, {
            documentTitle: basename(filePath),
            subjectName: 'Teste offline',
          }),
        status: isAnswerKey ? 'READY' : 'EMBEDDING_PENDING',
      });
      chunkIndexInBlock += 1;
    }
  }

  return { parsed, pages, blocks, chunks, skipped };
}

function documentReport(fileName: string, result: Awaited<ReturnType<typeof simulateDocument>>) {
  const skippedByReason = result.skipped.reduce<Record<string, number>>((counts, skipped) => {
    counts[skipped.reason] = (counts[skipped.reason] ?? 0) + 1;
    return counts;
  }, {});

  const lines = [
    `## ${fileName}`,
    '',
    `- Páginas extraídas: ${result.parsed.total}`,
    `- Páginas normalizadas: ${result.pages.length}`,
    `- Blocos simulados: ${result.blocks.length}`,
    `- Chunks que seriam inseridos: ${result.chunks.length}`,
    `- Fragmentos descartados: ${result.skipped.length}`,
    `- Descartes por motivo: ${Object.entries(skippedByReason).map(([reason, count]) => `${reason} (${count})`).join(', ') || 'nenhum'}`,
    '',
    '### Simulação de `document_chunks`',
    '',
    '| id | block | tipo do bloco | páginas | índice | tokens | status | conteúdo |',
    '| --- | --- | --- | --- | ---: | ---: | --- | --- |',
    ...result.chunks.map((chunk) => [
      chunk.id,
      chunk.blockId,
      chunk.blockType,
      chunk.pageStart ? `${chunk.pageStart}${chunk.pageEnd && chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ''}` : '',
      chunk.chunkIndexInBlock,
      countTokens(chunk.content),
      chunk.status,
      compact(chunk.content),
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '### Conteúdo descartado',
    '',
    '| bloco | tipo | páginas | motivo | conteúdo |',
    '| --- | --- | --- | --- | --- |',
    ...result.skipped.map((item) => [
      item.block.id,
      item.block.type,
      item.block.pageStart ? `${item.block.pageStart}${item.block.pageEnd && item.block.pageEnd !== item.block.pageStart ? `-${item.block.pageEnd}` : ''}` : '',
      item.reason,
      compact(item.content),
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
  ];

  return lines.join('\n');
}

async function main() {
  const inputDirectory = resolve(process.argv[2] ?? resolve(projectRoot(), 'docsTeste'));
  const outputPath = resolve(process.argv[3] ?? resolve(inputDirectory, 'chunk-simulation.md'));
  const fileNames = (await readdir(inputDirectory))
    .filter((fileName) => extname(fileName).toLowerCase() === '.pdf')
    .sort((left, right) => left.localeCompare(right, 'pt-BR'));

  if (fileNames.length === 0) throw new Error(`Nenhum PDF encontrado em ${inputDirectory}.`);

  const reports: string[] = [];
  for (const fileName of fileNames) {
    const result = await simulateDocument(resolve(inputDirectory, fileName));
    reports.push(documentReport(fileName, result));
  }

  const report = [
    '# Simulação Offline de Chunks',
    '',
    `Gerado em: ${new Date().toISOString()}`,
    `Diretório de entrada: \`${inputDirectory}\``,
    '',
    'Este relatório não acessa banco, storage, embeddings ou frontend. Ele simula os registros de `document_chunks` usando as regras atuais de qualidade do `ChunkService`.',
    '',
    ...reports,
  ].join('\n');

  await writeFile(outputPath, report, 'utf8');
  console.log(`Relatório criado em ${outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
