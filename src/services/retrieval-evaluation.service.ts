import {
  findRetrievalEvalCaseForRun,
  saveRetrievalEvalRun,
} from '../repositories/retrieval-evaluation.repository.js';
import {
  loadKnowledgeContext,
  searchReadyKnowledgeChunks,
} from '../repositories/knowledge-retrieval.repository.js';

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export class RetrievalEvaluationService {
  async runCase(caseId: string, queryEmbedding: number[], limit = 8) {
    const startedAt = Date.now();
    const evaluationCase = await findRetrievalEvalCaseForRun(caseId);
    if (!evaluationCase) throw new Error('Caso de avaliacao nao encontrado ou inativo.');

    const candidates = await searchReadyKnowledgeChunks({
      teacherId: evaluationCase.teacherId,
      monitorId: evaluationCase.monitorId,
      subjectId: evaluationCase.subjectId,
      queryEmbedding,
      limit,
    });
    const uniqueCandidates = candidates.filter((candidate, index, all) => (
      candidate.blockId === null
        || all.findIndex((item) => item.blockId === candidate.blockId) === index
    ));
    await loadKnowledgeContext(uniqueCandidates);

    const expectedBlockIds = stringArray(evaluationCase.expectedBlockIds);
    const returnedBlockIds = uniqueCandidates
      .map((candidate) => candidate.blockId)
      .filter((id): id is string => Boolean(id));
    const returnedChunkIds = uniqueCandidates.map((candidate) => candidate.chunkId);
    const returnedSet = new Set(returnedBlockIds);
    const matchedCount = expectedBlockIds.filter((id) => returnedSet.has(id)).length;
    const recallAtK = expectedBlockIds.length === 0 ? 0 : matchedCount / expectedBlockIds.length;
    const firstMatchIndex = returnedBlockIds.findIndex((id) => expectedBlockIds.includes(id));
    const reciprocalRank = firstMatchIndex < 0 ? 0 : 1 / (firstMatchIndex + 1);
    const contextPrecision = returnedBlockIds.length === 0
      ? 0
      : returnedBlockIds.filter((id) => expectedBlockIds.includes(id)).length / returnedBlockIds.length;
    const durationMs = Date.now() - startedAt;

    const run = await saveRetrievalEvalRun({
      caseId,
      topK: limit,
      returnedBlockIds,
      returnedChunkIds,
      recallAtK,
      reciprocalRank,
      contextPrecision,
      durationMs,
    });

    console.log('Caso de avaliacao de retrieval concluido', {
      event: 'monitor.retrieval_evaluation_completed',
      caseId,
      runId: run.id,
      topK: limit,
      recallAtK,
      reciprocalRank,
      contextPrecision,
      durationMs,
    });

    return { run, citations: uniqueCandidates };
  }
}
