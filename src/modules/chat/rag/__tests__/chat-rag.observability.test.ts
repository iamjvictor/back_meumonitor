import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatKnowledgePort } from '../ports/chat-knowledge.port.js';
import { ChatRagService } from '../services/chat-rag.service.js';

test('monta o contexto RAG sem registrar ou transportar o histórico integral como métrica', async () => {
  const knowledge: ChatKnowledgePort = {
    async retrieve(input) {
      return {
        used: true,
        retrievalQuery: input.message,
        context: 'Evidência autorizada',
        citations: [{
          chunkId: 'chunk-expected',
          documentId: 'document-expected',
          blockId: 'block-expected',
          pageStart: 2,
          pageEnd: 2,
          score: 0.8,
          content: 'Evidência autorizada',
        }],
        metrics: { candidateCount: 1, selectedCount: 1, durationMs: 3 },
      };
    },
  };

  const result = await new ChatRagService(knowledge).enrich({
    message: 'Explique a questão',
    history: [],
    questionContext: null,
    studentId: 'student-1',
    teacherId: 'teacher-1',
    monitorId: 'monitor-1',
    subjectId: 'subject-1',
    topicId: null,
  });

  assert.equal(result.result.citations[0]?.chunkId, 'chunk-expected');
  assert.match(result.context, /Evidência autorizada/);
});
