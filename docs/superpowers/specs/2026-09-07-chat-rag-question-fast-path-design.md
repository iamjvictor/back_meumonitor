# Spec — Fast Path de Evidência Oficial e Retrieval Rápido do Chat

**Data:** 2026-09-07  
**Status:** V1 implementada; validação oficial de questões e flashcards concluída
**Escopo:** reduzir o retrieval do Chat RAG de aproximadamente 8,1s para até 4s e tornar respostas sobre questões e flashcards mais consistentes usando as fontes oficiais já relacionadas no banco.

> [!IMPORTANT]
> **CONTINUAR AMANHÃ:** validar o plano SQL com `EXPLAIN (ANALYZE, BUFFERS)` e otimizar o
> caminho sem anexo, que ainda depende do embedding remoto.

## Status da implementação

### Implementado

- [x] Contexto opcional de questão e flashcard no endpoint público do chat.
- [x] Validação de monitor, matéria, tópico e tentativa da questão.
- [x] Reidratação do conteúdo oficial no backend; o frontend envia apenas IDs.
- [x] Busca direta de evidências de questões através de `QuestionSource`.
- [x] Busca direta de evidências de flashcards aprovados através de `FlashcardSource`.
- [x] Estratégia `DIRECT_QUESTION_SOURCE` sem embedding quando a evidência é suficiente.
- [x] Estratégia `DIRECT_FLASHCARD_SOURCE` sem embedding quando a evidência é suficiente.
- [x] Cache de evidências no Redis com TTL deslizante da conversa.
- [x] Herança de questão ou flashcard pelo histórico recente do Redis.
- [x] Fallback para `SEMANTIC_RETRIEVAL` quando não há evidência oficial suficiente.
- [x] Logs de estratégia, cache, fontes, embeddings, retrieval e qualidade.
- [x] Indicador visual de anexo de questão e flashcard na mensagem do aluno.
- [x] Flashcard pode ser anexado pelo modal de revisão através de “Tirar dúvida com IA”.

Resultado observado no teste de flashcard:

```text
strategy: DIRECT_FLASHCARD_SOURCE
shouldEmbed: false
evidenceSufficient: true
scoreAverage: 1
retrievalDurationMs: 632
durationMs: 6619
```

### Pendente

- [ ] Otimizar o caminho sem anexo para reduzir a dependência de embedding remoto e manter p95 abaixo de 4s.
- [ ] Implementar `ChatQueryRewriter` seletivo para mensagens ambíguas ou muito curtas.
- [ ] Implementar decomposição de consultas complexas.
- [ ] Melhorar reranking e avaliação automática de relevância das evidências.
- [ ] Adicionar streaming SSE da resposta ao frontend.
- [ ] Exibir citações/fontes ao aluno, caso essa decisão de produto seja aprovada.
- [ ] Extrair o chat para serviço separado quando a necessidade de escala justificar.

## 1. Problema observado

Na execução `req-m`, o retrieval apresentou:

```text
embedding:       3,178 ms
retrieval total: 8,192 ms
score médio:     0,321
evidências:      5
```

A questão já tinha fonte oficial:

```text
QuestionSource: 1 registro
documentId:     5540237d-afcb-4f84-b9fa-0b36d2bd2efa
documentBlockId: 7e68f3c1-495a-4200-93ff-18e466c9bd78
```

Mesmo assim, o sistema gerou embedding de uma consulta com até 4.841 caracteres e procurou chunks semanticamente relacionados.

## 2. Constatações do schema Prisma

O schema já possui informação suficiente para um caminho determinístico:

### `Question`

Possui:

- `correctAnswer`;
- `explanation`;
- `correctAnswerConfidence`;
- `explanationConfidence`;
- `completenessStatus`;
- `qualityScore`;
- `status` e `needsReview`.

### `QuestionSource`

Relaciona uma questão diretamente a:

- `chunkId` obrigatório;
- `documentId`;
- `documentBlockId`;
- `role` (`STATEMENT`, `ANSWER_KEY`, `EXPLANATION`, `CONTEXT`);
- `excerpt`;
- `confidence`;
- posição dentro do chunk.

### `DocumentChunk`

Possui:

- `embedding` vetorial;
- `embeddingContent`;
- `status`;
- `blockId`;
- `chunkIndexInBlock`;
- `documentId`, `teacherId`, `monitorId` e `subjectId`.

### `DocumentBlock`

Possui tipos estruturais `QUESTION`, `ANSWER_KEY` e `SOLUTION`, além de hierarquia por `parentBlockId`.

## 3. Causa da inconsistência atual

O chat carrega atualmente somente os metadados da fonte primária em `chat.routes.ts`. Ele não carrega:

- `Question.correctAnswer`;
- `Question.explanation`;
- todos os `QuestionSource` da questão;
- conteúdo dos chunks associados às fontes;
- blocos `ANSWER_KEY` ou `SOLUTION` relacionados.

Além disso, o retrieval atual usa `questionDocumentId` como filtro de documento e usa `questionBlockId` como bloco excluído. Isso evita duplicar o enunciado, mas não constitui uma busca explícita pelo gabarito.

Há uma limitação adicional no pipeline: em `chunk.service.ts`, blocos `ANSWER_KEY` recebem `embeddingContent: null`. Portanto, um gabarito pode existir no banco e estar ligado por `QuestionSource`, mas não estar disponível para busca vetorial. Essa fonte deve ser acessada por relação direta, não por embedding.

## 4. Objetivos

1. Usar a fonte oficial da questão como evidência primária.
2. Não gerar embedding quando a questão já possuir resposta/resolução oficial suficiente.
3. Usar embedding apenas como complemento para conceitos ou questões sem suporte oficial.
4. Reduzir o retrieval de questão para p95 menor ou igual a 4 segundos, com alvo de até 1 segundo no caminho determinístico.
5. Manter o fallback semântico quando a fonte oficial estiver incompleta.
6. Garantir isolamento por `teacherId`, `monitorId`, `subjectId` e `questionId`.

## 5. Não objetivos

- Não alterar o modelo de embedding dos documentos nesta etapa.
- Não tornar `ANSWER_KEY` semanticamente pesquisável por padrão.
- Não persistir mensagens do chat no PostgreSQL.
- Não trocar o modelo de geração do chat.
- Não implementar streaming nesta etapa.

## 6. Tipos de entrada do chat

O endpoint público continuará sendo único na V1. A mensagem pode chegar com ou sem anexo:

```json
{
  "message": "Não entendi essa parte",
  "contextAttachment": {
    "type": "QUESTION",
    "id": "question-uuid",
    "attemptId": "attempt-uuid"
  }
}
```

Para flashcard:

```json
{
  "message": "Pode explicar este conceito com um exemplo?",
  "contextAttachment": {
    "type": "FLASHCARD",
    "id": "flashcard-uuid"
  }
}
```

O anexo enviado pelo frontend contém somente identificadores e dados de interação. O backend
sempre reidrata o conteúdo oficial no PostgreSQL e valida o escopo. O frontend não pode enviar
`front`, `back`, gabarito ou explicação como fonte confiável.

### 6.1 Mensagem sem anexo

Quando não houver anexo, o sistema deve verificar o histórico recente do Redis:

1. localizar a última mensagem do aluno que contenha `contextAttachment`;
2. confirmar que o anexo pertence ao mesmo aluno, monitor e matéria;
3. considerar esse anexo como contexto ativo para uma pergunta de continuidade;
4. se não houver anexo ativo, usar somente a mensagem atual e o histórico textual resumido.

O contexto ativo não deve ser inferido de uma conversa antiga de outro monitor ou matéria.
Uma nova mensagem com anexo substitui o contexto ativo anterior. Um endpoint futuro poderá
limpar o contexto sem apagar o histórico, mas isso não é necessário para a V1.

### 6.2 Questão no histórico

O histórico deve salvar no item da mensagem do aluno somente a referência:

```ts
type ChatHistoryContextAttachment =
  | { type: 'QUESTION'; id: string; attemptId?: string | null }
  | { type: 'FLASHCARD'; id: string };
```

Ao reutilizar uma questão do histórico, o backend busca novamente a questão, a tentativa e as
fontes oficiais. Nunca deve confiar em um snapshot antigo do enunciado salvo no Redis.

### 6.3 Flashcard anexado

O flashcard autorizado deve ser carregado por `Flashcard.id` com os filtros:

- `teacherId`;
- `monitorId`;
- `subjectId`;
- `status = APPROVED`.

O contexto direto deve incluir:

- `front`;
- `back`;
- `kind`;
- tópico;
- chunks relacionados por `FlashcardSource`;
- páginas e conteúdo dos chunks, quando disponíveis.

O `back` é a fonte oficial do flashcard. O retrieval semântico é complementar e só deve ser
executado quando o verso estiver ausente, insuficiente ou quando o aluno pedir aprofundamento
conceitual fora do conteúdo do card.

## 7. Arquitetura proposta

```text
mensagem do aluno
        ↓
questão anexada?
   ┌────┴────┐
  sim       não
   ↓         ↓
QuestionEvidenceService   consulta curta
   ↓                       ↓
fontes diretas             embedding
   ↓                       ↓
evidência oficial          retrieval híbrido
   └──────────┬────────────┘
              ↓
        ContextAssembler
              ↓
        ChatGenerationPort
```

### Estratégia A — `DIRECT_QUESTION_SOURCE`

Usada quando existe `questionContext` autorizado.

1. Buscar a questão dentro do escopo autorizado.
2. Carregar `correctAnswer`, `explanation` e suas confianças.
3. Carregar todos os `QuestionSource` da questão, ordenados por:
   - `role`: `ANSWER_KEY`, `EXPLANATION`, `CONTEXT`, `STATEMENT`;
   - `confidence` decrescente;
   - `createdAt` crescente.
4. Buscar os chunks pelos `QuestionSource.chunkId`.
5. Buscar os blocos relacionados pelos `documentBlockId` e seus pais imediatos.
6. Montar a evidência oficial sem embedding.
7. Executar retrieval semântico somente se a evidência oficial não atingir o mínimo de qualidade.

### Estratégia B — `DIRECT_FLASHCARD_SOURCE`

Usada quando existe `contextAttachment.type = FLASHCARD` ou quando o último anexo ativo do
histórico é um flashcard.

1. Validar o flashcard no escopo autorizado.
2. Carregar `front`, `back`, tópico e status.
3. Carregar `FlashcardSource` e seus chunks diretamente.
4. Montar o contexto oficial do card.
5. Executar retrieval semântico somente se o contexto não for suficiente.

### Estratégia C — `SEMANTIC_RETRIEVAL`

Usada quando não existe questão anexada ou quando a fonte oficial é insuficiente.

1. Construir uma consulta curta com a dúvida atual, tópico e no máximo duas mensagens relevantes.
2. Gerar um embedding.
3. Buscar chunks `READY` dentro do escopo.
4. Aplicar filtros de tópico, documento e tipos de bloco.
5. Ranquear e montar o contexto.

### Estratégia D — `QUESTION_EVIDENCE_CACHE`

Usada em mensagens seguintes sobre a mesma questão.

Chave Redis:

```text
chat:rag:evidence:v1:{studentId}:{monitorId}:{subjectId}:{questionId}
```

Para flashcards, a chave equivalente será:

```text
chat:rag:evidence:v1:{studentId}:{monitorId}:{subjectId}:flashcard:{flashcardId}
```

TTL: cinco horas desde a última atividade do chat.

O cache deve armazenar apenas a evidência normalizada e seus metadados, não a mensagem inteira do aluno.

## 8. Contratos

### 7.1 Evidência oficial

```ts
type QuestionEvidenceResult = {
  strategy: 'DIRECT_QUESTION_SOURCE' | 'EVIDENCE_CACHE' | 'SEMANTIC_RETRIEVAL';
  sufficient: boolean;
  questionId: string;
  answer: string | null;
  explanation: string | null;
  citations: Array<{
    chunkId: string;
    documentId: string;
    blockId: string | null;
    role: 'STATEMENT' | 'ANSWER_KEY' | 'EXPLANATION' | 'CONTEXT';
    content: string;
    confidence: number | null;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
  context: string;
  metrics: {
    sourceCount: number;
    chunkCount: number;
    answerKeyCount: number;
    explanationCount: number;
    durationMs: number;
  };
};
```

### 7.2 Evidência de flashcard

```ts
type FlashcardEvidenceResult = {
  strategy: 'DIRECT_FLASHCARD_SOURCE' | 'EVIDENCE_CACHE' | 'SEMANTIC_RETRIEVAL';
  sufficient: boolean;
  flashcardId: string;
  front: string;
  back: string;
  topicId: string;
  citations: Array<{
    chunkId: string;
    documentId: string;
    blockId: string | null;
    content: string;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
  context: string;
  metrics: {
    sourceCount: number;
    chunkCount: number;
    durationMs: number;
  };
};
```

### 7.3 Decisão de retrieval

```ts
type ChatRetrievalDecision = {
  strategy: 'DIRECT_QUESTION_SOURCE' | 'DIRECT_FLASHCARD_SOURCE' | 'EVIDENCE_CACHE' | 'SEMANTIC_RETRIEVAL';
  shouldEmbed: boolean;
  reason:
    | 'QUESTION_HAS_OFFICIAL_EVIDENCE'
    | 'FLASHCARD_HAS_OFFICIAL_EVIDENCE'
    | 'QUESTION_EVIDENCE_CACHE_HIT'
    | 'QUESTION_EVIDENCE_INSUFFICIENT'
    | 'NO_QUESTION_CONTEXT';
};
```

O tipo do contexto normalizado deve ser discriminado:

```ts
type ChatResolvedContext =
  | { type: 'QUESTION'; id: string; question: AuthorizedQuestionContext; evidence: QuestionEvidenceResult }
  | { type: 'FLASHCARD'; id: string; front: string; back: string; topicId: string; evidence: FlashcardEvidenceResult }
  | { type: 'NONE' };
```

## 9. Critério para considerar a fonte oficial suficiente

A fonte oficial é suficiente quando pelo menos uma das condições for verdadeira:

```text
correctAnswer existe e correctAnswerConfidence >= 0.80
```

ou:

```text
há pelo menos um QuestionSource ANSWER_KEY
e o chunk está READY
```

ou:

```text
há pelo menos um QuestionSource EXPLANATION
e o chunk está READY
```

Quando existir somente a questão/enunciado, a fonte não é suficiente para responder com segurança e o retrieval semântico complementar deve ser usado.

Para flashcards, a fonte é suficiente quando o card está `APPROVED`, possui `front` e `back`
não vazios e pertence ao escopo autorizado. A ausência de `FlashcardSource` não invalida o
card, mas impede considerar o material do livro como evidência complementar direta.

## 10. Consulta direta aos chunks oficiais

A consulta deve usar uma única operação de leitura para carregar fontes e chunks, evitando N+1:

```sql
SELECT
  qs.role,
  qs.confidence AS source_confidence,
  qs.excerpt,
  dc.id AS chunk_id,
  dc.document_id,
  dc.block_id,
  dc.content,
  dc.page_start,
  dc.page_end,
  dc.status AS chunk_status,
  db.type AS block_type,
  db.normalized_content AS block_content
FROM question_sources qs
JOIN document_chunks dc ON dc.id = qs.chunk_id
LEFT JOIN document_blocks db ON db.id = qs.document_block_id
WHERE qs.question_id = $1
  AND dc.teacher_id = $2
  AND dc.monitor_id = $3
  AND dc.subject_id = $4
  AND dc.status = 'READY'
ORDER BY
  CASE qs.role
    WHEN 'ANSWER_KEY' THEN 1
    WHEN 'EXPLANATION' THEN 2
    WHEN 'CONTEXT' THEN 3
    WHEN 'STATEMENT' THEN 4
  END,
  qs.confidence DESC NULLS LAST,
  qs.created_at ASC;
```

O `Question` deve ser carregado na mesma transação/leitura com os campos de resposta e explicação, sempre validando o mesmo escopo.

Para flashcards, a consulta deve partir de `flashcards` e juntar `flashcard_sources` e
`document_chunks`. O filtro de status deve aceitar somente `APPROVED`; o texto do `back` deve
ser incluído mesmo quando os chunks relacionados não tiverem embedding.

## 11. Orçamento de latência

### Caminho direto com questão oficial

```text
autorização e questão:    <= 300 ms
fontes e chunks:          <= 500 ms
montagem de contexto:     <= 100 ms
retrieval total alvo:     <= 1.000 ms
```

### Caminho semântico

```text
embedding:                <= 2.000 ms
consulta PostgreSQL:      <= 1.500 ms
ranking e contexto:       <= 500 ms
retrieval total máximo:   <= 4.000 ms
```

Se o provider de embedding exceder o timeout de 2 segundos, o sistema deve seguir sem evidência semântica ou utilizar somente a evidência direta já disponível. Não deve bloquear a resposta indefinidamente.

O tempo de geração do LLM é medido separadamente. O alvo de 4 segundos refere-se ao estágio de retrieval, não à resposta completa do modelo.

## 12. Logs obrigatórios

```text
chat.rag_strategy_selected
chat.context_attachment_resolved
chat.question_evidence_started
chat.question_evidence_completed
chat.flashcard_evidence_started
chat.flashcard_evidence_completed
chat.rag_evidence_cache_hit
chat.rag_evidence_cache_miss
chat.rag_embedding_skipped
chat.rag_embedding_started
chat.rag_retrieval_completed
chat.rag_context_assembled
```

Os logs devem conter:

- `requestId`;
- `questionId`;
- estratégia escolhida;
- `shouldEmbed`;
- `sourceCount`, `chunkCount` e `citationCount`;
- duração por etapa;
- motivo de fallback.

Não registrar o conteúdo integral de chunks, gabaritos ou mensagens.

## 13. Testes de aceitação

1. Questão com `QuestionSource.ANSWER_KEY` não chama o endpoint de embedding.
2. Questão com `QuestionSource.EXPLANATION` retorna a explicação oficial no contexto.
3. Questão com somente fonte `STATEMENT` executa fallback semântico.
4. Questão fora do monitor/matéria do aluno não retorna fontes.
5. Chunks `ANSWER_KEY` sem embedding são retornados pela consulta direta.
6. Cache de evidência evita novo embedding em uma segunda mensagem da mesma questão.
7. Retrieval semântico cancela ou abandona o embedding após 2 segundos.
8. O caminho direto permanece abaixo de 1 segundo em teste de integração local.
9. O retrieval semântico permanece abaixo de 4 segundos em teste com doubles controlados.
10. Mensagem sem anexo usa a última questão válida do histórico quando existir.
11. Mensagem sem anexo e sem histórico executa retrieval semântico usando somente a dúvida atual e contexto de matéria/tópico.
12. Nova questão substitui a questão ativa anterior no histórico.
13. Flashcard `APPROVED` retorna `front` e `back` sem gerar embedding.
14. Flashcard `PENDING_REVIEW` ou de outro monitor/matéria é rejeitado.
15. Flashcard sem fontes usa o `back` como evidência oficial e não falha por falta de chunks.
16. Segunda pergunta sobre o mesmo flashcard reutiliza a evidência em cache.

## 14. Resultado esperado

Para dúvidas sobre uma questão já vinculada a fontes oficiais, o chat deve responder usando primeiro a evidência determinística da própria questão. O embedding passa a ser uma ferramenta de complemento, não uma etapa obrigatória de toda mensagem.

## 15. Benchmark e comparação operacional

O benchmark controlado da implementação está em
`src/modules/chat/rag/__tests__/question-fast-path.performance.test.ts`. Ele usa doubles
para medir o custo do retrieval/contexto sem misturar a latência variável do OpenRouter,
do PostgreSQL remoto ou da geração do LLM.

O baseline observado antes do fast path foi de aproximadamente 8,1 segundos para uma
requisição completa. Esse valor não deve ser comparado diretamente com o benchmark de
retrieval: a geração do LLM possui orçamento separado. Em um teste real, a comparação deve
usar `chat.rag_context_assembled` para o estágio RAG e `chat.generation_completed` para o
tempo total.

O schema atual já possui os índices necessários para o caminho direto:

- `QuestionSource` possui índice único iniciado por `(questionId, chunkId, role)` e índice
  auxiliar `(chunkId, questionId)`;
- `DocumentChunk` possui índice único `(blockId, chunkIndexInBlock)`;
- `DocumentChunk` possui índices de escopo `(monitorId, subjectId)` e
  `(teacherId, monitorId)`;
- `Flashcard` possui índice `(monitorId, subjectId, topicId, status)`;
- `FlashcardSource` possui índice `(chunkId, flashcardId)`.

Não foi adicionada migração nesta fase, pois os índices existentes cobrem os filtros e
joins previstos. A confirmação do plano físico com `EXPLAIN (ANALYZE, BUFFERS)` deve ser
executada no ambiente PostgreSQL de teste com dados representativos antes do deploy.
