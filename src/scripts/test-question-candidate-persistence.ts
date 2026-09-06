import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { markQuestionCandidatePromoted, upsertQuestionSpanCandidate } from '../repositories/question-candidate.repository.js';

async function main() {
  const chunk = await prisma.documentChunk.findFirst({
    where: { status: { in: ['READY', 'EMBEDDING_PENDING'] } },
    select: {
      id: true,
      documentId: true,
      blockId: true,
      charStart: true,
      charEnd: true,
      block: { select: { pageStart: true, pageEnd: true } },
    },
  });
  if (!chunk) throw new Error('Nenhum chunk disponivel para o teste de persistencia.');

  const sourceKey = `__question-candidate-persistence-test-${createHash('sha256').update(`${Date.now()}-${chunk.id}`).digest('hex')}`;
  try {
    const span = await upsertQuestionSpanCandidate({
      documentId: chunk.documentId,
      documentBlockId: chunk.blockId,
      sourceKey,
      questionNumber: 'TEST',
      chunkIds: [chunk.id],
      pageStart: chunk.block?.pageStart ?? null,
      pageEnd: chunk.block?.pageEnd ?? null,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      statement: 'Candidata temporaria para validar a persistencia do novo fluxo.',
      alternatives: [],
      correctAnswer: null,
      explanation: null,
      spanStatus: 'REVIEW_REQUIRED',
      visualStatus: 'NOT_REQUIRED',
      candidateStatus: 'REVIEW_REQUIRED',
      structuralState: 'CONVERTIBLE_TO_MULTIPLE_CHOICE',
      promotionReasons: ['TEST_ONLY'],
      confidence: 1,
      evidence: { test: true },
      metadata: { test: true },
    });
    const saved = await prisma.questionSpan.findUnique({
      where: { sourceKey },
      include: { chunks: true, candidate: true },
    });
    if (!saved?.candidate || saved.chunks.length !== 1 || saved.candidate.status !== 'REVIEW_REQUIRED') {
      throw new Error('QuestionSpan/QuestionCandidate nao foram persistidos conforme esperado.');
    }
    await upsertQuestionSpanCandidate({
      documentId: chunk.documentId,
      documentBlockId: chunk.blockId,
      sourceKey,
      questionNumber: 'TEST',
      chunkIds: [chunk.id],
      pageStart: chunk.block?.pageStart ?? null,
      pageEnd: chunk.block?.pageEnd ?? null,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      statement: 'Candidata temporaria promovida para validar a transicao.',
      alternatives: [
        { label: 'A', text: 'Alternativa de teste' },
        { label: 'B', text: 'Alternativa de controle' },
      ],
      correctAnswer: null,
      explanation: null,
      spanStatus: 'READY_FOR_COMPLETION',
      visualStatus: 'NOT_REQUIRED',
      candidateStatus: 'READY_FOR_COMPLETION',
      structuralState: 'STRUCTURALLY_VALID',
      promotionReasons: [],
      confidence: 1,
      evidence: { test: true, promoted: true },
      metadata: { test: true, promoted: true },
    });
    await markQuestionCandidatePromoted(sourceKey);
    const promoted = await prisma.questionSpan.findUnique({
      where: { sourceKey },
      include: { chunks: true, candidate: true },
    });
    if (promoted?.status !== 'READY_FOR_COMPLETION' || promoted.candidate?.status !== 'PROMOTED' || promoted.chunks.length !== 1) {
      throw new Error('A transicao READY_FOR_COMPLETION -> PROMOTED falhou.');
    }
    console.log(JSON.stringify({
      ok: true,
      spanId: span.id,
      candidateId: saved.candidate.id,
      retainedStatus: saved.candidate.status,
      promotedStatus: promoted.candidate.status,
      chunkLinks: promoted.chunks.length,
    }));
  } finally {
    await prisma.questionSpan.deleteMany({ where: { sourceKey } });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
