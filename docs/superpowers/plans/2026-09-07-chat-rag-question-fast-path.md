# Chat RAG Question Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar evidência oficial direta para questões e flashcards, resolver contexto ativo pelo histórico e reduzir o estágio de retrieval do chat para no máximo 4 segundos.

**Architecture:** Criar adapters de evidência para `Question` e `Flashcard`, ambos baseados nas relações de fontes já existentes. O `ChatRagService` resolverá anexos explícitos ou herdados do histórico e escolherá entre fonte direta, cache Redis e retrieval semântico; o embedding só será chamado no caminho semântico.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Redis, OpenRouter embeddings, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-chat-rag-question-fast-path-design.md`

**Status atual:** implementação funcional concluída para questões e flashcards. O único item
técnico deste plano ainda pendente é a medição real com `EXPLAIN (ANALYZE, BUFFERS)` em uma
conexão PostgreSQL disponível. A integração visual do frontend também foi concluída.

> [!IMPORTANT]
> **CONTINUAR AMANHÃ — Próximo ponto:** executar `EXPLAIN (ANALYZE, BUFFERS)` na consulta
> direta de evidências e, em seguida, medir a latência do caminho sem anexo.

## Global Constraints

- O caminho de questão oficial deve consultar `QuestionSource` diretamente.
- Chunks `ANSWER_KEY` não dependem de embedding.
- O embedding semântico deve ter timeout de 2 segundos.
- O retrieval total deve possuir orçamento de 4 segundos.
- O escopo obrigatório é `teacherId`, `monitorId` e `subjectId`; `questionId` ou `flashcardId` é obrigatório quando houver anexo.
- Flashcards devem ser validados por `teacherId`, `monitorId`, `subjectId` e `status = APPROVED`.
- Nenhum conteúdo integral deve aparecer nos logs.
- Cada tarefa deve ser implementada com teste falho antes do código.

---

### Task 1: Criar o contrato de evidência oficial

**Files:**
- Create: `src/modules/chat/rag/models/question-evidence.model.ts`
- Create: `src/modules/chat/rag/ports/question-evidence.port.ts`
- Test: `src/modules/chat/rag/services/__tests__/question-evidence-sufficiency.test.ts`

**Interfaces:**
- `QuestionEvidencePort.get(input): Promise<QuestionEvidenceResult>`
- `isQuestionEvidenceSufficient(input): boolean`

- [x] Escrever teste para considerar suficiente uma questão com resposta oficial e confiança mínima `0.80`.
- [x] Escrever teste para considerar suficiente uma fonte `ANSWER_KEY` ou `EXPLANATION` com chunk `READY`.
- [x] Escrever teste para rejeitar uma questão que possui somente fonte `STATEMENT`.
- [x] Executar o teste focado e confirmar a falha inicial.
- [x] Implementar os tipos e o predicado de suficiência.
- [x] Executar o teste focado e confirmar aprovação.

### Task 2: Implementar a consulta direta de fontes

**Files:**
- Create: `src/modules/chat/rag/providers/prisma-question-evidence.provider.ts`
- Create: `src/modules/chat/rag/providers/__tests__/prisma-question-evidence.provider.test.ts`
- Modify: `src/modules/chat/chat.routes.ts`

**Interfaces:**
- O provider receberá `PrismaClient` ou uma porta de consulta injetável.
- A consulta deve retornar `Question`, `QuestionSource`, `DocumentChunk` e `DocumentBlock` em uma única operação lógica.

- [x] Escrever teste com fake repository contendo `ANSWER_KEY` sem embedding e `EXPLANATION` com embedding.
- [x] Confirmar que os dois chunks são retornados por relação direta.
- [x] Confirmar que um escopo diferente não retorna evidência.
- [x] Implementar a consulta com filtro de `teacherId`, `monitorId`, `subjectId`, `questionId` e `status = READY`.
- [x] Ordenar `ANSWER_KEY`, `EXPLANATION`, `CONTEXT`, `STATEMENT` nessa ordem.
- [x] Executar os testes do provider.
- [x] Alterar a rota para carregar a evidência completa em vez de somente a fonte primária.

### Task 3: Implementar o contrato e provider de flashcard

**Files:**
- Create: `src/modules/chat/rag/models/flashcard-evidence.model.ts`
- Create: `src/modules/chat/rag/providers/prisma-flashcard-evidence.provider.ts`
- Create: `src/modules/chat/rag/providers/__tests__/prisma-flashcard-evidence.provider.test.ts`

**Interfaces:**
- `FlashcardEvidencePort.get(input): Promise<FlashcardEvidenceResult>`

- [x] Escrever teste para flashcard `APPROVED` com `front`, `back` e `FlashcardSource`.
- [x] Escrever teste para rejeitar flashcard `PENDING_REVIEW`.
- [x] Escrever teste para rejeitar flashcard de outro monitor ou matéria.
- [x] Escrever teste para aceitar card aprovado sem `FlashcardSource`, usando o `back` como fonte oficial.
- [x] Implementar consulta direta a `Flashcard`, `FlashcardSource` e `DocumentChunk`.
- [x] Executar os testes do provider.

### Task 4: Resolver anexo explícito e contexto ativo do histórico

**Files:**
- Modify: `src/modules/chat/models/chat.model.ts`
- Modify: `src/modules/chat/models/chat-history.model.ts`
- Modify: `src/modules/chat/chat.routes.ts`
- Create: `src/modules/chat/rag/services/chat-context-resolver.service.ts`
- Create: `src/modules/chat/rag/services/__tests__/chat-context-resolver.service.test.ts`

**Interfaces:**
- `ChatContextAttachment = { type: 'QUESTION' | 'FLASHCARD'; id: string; attemptId?: string | null }`.
- `resolve(input): Promise<ChatResolvedContext>`.

- [x] Escrever teste para anexo explícito de questão.
- [x] Escrever teste para anexo explícito de flashcard.
- [x] Escrever teste para mensagem sem anexo recuperar a última referência válida do histórico.
- [x] Escrever teste para mensagem sem anexo e sem histórico retornar contexto `NONE`.
- [x] Escrever teste para impedir herança de anexo de outro escopo.
- [x] Estender o schema de entrada sem remover a compatibilidade com `questionContext` atual.
- [x] Persistir somente a referência do anexo no item do aluno no Redis.
- [x] Implementar a resolução baseada somente em referências; a reidratação oficial ficará nos providers das Tasks 2 e 3 durante a escolha da estratégia.

### Task 5: Escolher a estratégia sem embedding desnecessário

**Files:**
- Create: `src/modules/chat/rag/services/chat-retrieval-strategy.service.ts`
- Create: `src/modules/chat/rag/services/__tests__/chat-retrieval-strategy.service.test.ts`
- Modify: `src/modules/chat/rag/services/chat-rag.service.ts`

**Interfaces:**
- `choose(input): Promise<ChatRetrievalDecision>`
- Estratégias: `DIRECT_QUESTION_SOURCE`, `DIRECT_FLASHCARD_SOURCE`, `QUESTION_EVIDENCE_CACHE`, `SEMANTIC_RETRIEVAL`.

- [x] Escrever teste que seleciona `DIRECT_QUESTION_SOURCE` e `shouldEmbed: false` para questão suficiente.
- [x] Escrever teste que seleciona `DIRECT_FLASHCARD_SOURCE` e `shouldEmbed: false` para flashcard suficiente.
- [x] Escrever teste que seleciona `SEMANTIC_RETRIEVAL` para evidência insuficiente.
- [x] Escrever teste que seleciona `EVIDENCE_CACHE` quando existe evidência cacheada.
- [x] Executar os testes e confirmar a falha inicial.
- [x] Implementar a decisão determinística.
- [x] Integrar a decisão ao `ChatRagService`.
- [x] Registrar `chat.rag_strategy_selected`.

### Task 6: Montar o contexto oficial de questão e flashcard

**Files:**
- Create: `src/modules/chat/rag/services/question-evidence.context.ts`
- Create: `src/modules/chat/rag/services/flashcard-evidence.context.ts`
- Create: `src/modules/chat/rag/services/__tests__/question-evidence.context.test.ts`
- Create: `src/modules/chat/rag/services/__tests__/flashcard-evidence.context.test.ts`
- Modify: `src/modules/chat/rag/services/chat-context.assembler.ts`

- [x] Escrever teste que coloca resposta e explicação oficial antes do suporte semântico.
- [x] Escrever teste que preserva indicação de fonte, página, papel e confiança.
- [x] Escrever teste de limite de caracteres sem cortar o gabarito no meio quando houver evidência oficial.
- [x] Implementar montagem com seções `[GABARITO OFICIAL]`, `[EXPLICAÇÃO OFICIAL]` e suporte conceitual recuperado.
- [x] Executar os testes de montagem e os testes existentes do assembler.

### Task 7: Cache Redis de evidência de questão e flashcard

**Files:**
- Modify: `src/modules/chat/rag/ports/question-evidence.port.ts`
- Create: `src/modules/chat/rag/repositories/redis-chat-evidence.repository.ts`
- Create: `src/modules/chat/rag/repositories/__tests__/redis-chat-evidence.repository.test.ts`
- Modify: `src/modules/chat/chat.module.ts`

- [x] Escrever teste para chaves de questão e flashcard com escopo completo.
- [x] Escrever teste para TTL de 18000 segundos após gravação.
- [x] Escrever teste para rejeitar cache de escopo diferente.
- [x] Implementar leitura e gravação do contexto normalizado, sem mensagem do aluno.
- [x] Integrar cache antes do retrieval semântico.
- [x] Registrar `chat.rag_evidence_cache_hit` e `chat.rag_evidence_cache_miss`.

### Task 8: Reduzir e limitar o embedding semântico

**Files:**
- Modify: `src/modules/chat/rag/services/chat-query.builder.ts`
- Modify: `src/modules/chat/rag/providers/knowledge-retrieval-chat.provider.ts`
- Create: `src/modules/chat/rag/services/__tests__/chat-query.latency.test.ts`

- [x] Escrever teste que usa somente a mensagem atual, tópico e no máximo duas mensagens anteriores.
- [x] Confirmar que a consulta semântica fica abaixo de 2.000 caracteres no caso comum.
- [x] Adicionar timeout de 2 segundos ao embedding do caminho semântico.
- [x] Fazer fallback para evidência direta ou resposta sem evidência quando o timeout ocorrer.
- [x] Registrar duração e motivo do fallback.
- [x] Executar os testes de latency e os testes do provider.

### Task 9: Índices, benchmark e critérios de aceite

**Files:**
- Modify: `prisma/schema.prisma` somente se um índice ausente for confirmado pelo plano de execução SQL.
- Create: `src/modules/chat/rag/__tests__/question-fast-path.performance.test.ts`
- Modify: `src/modules/chat/README.md`
- Modify: `docs/superpowers/specs/2026-09-07-chat-rag-service-design.md`

- [ ] Medir o plano SQL da consulta direta com `EXPLAIN (ANALYZE, BUFFERS)`.
- [ ] Medir o plano SQL da consulta direta com `EXPLAIN (ANALYZE, BUFFERS)` — pendente de conexão PostgreSQL no ambiente local.
- [x] Confirmar no schema os índices `QuestionSource(questionId, chunkId)`, `DocumentChunk(blockId, chunkIndexInBlock)` e os índices de escopo.
- [x] Criar benchmark com doubles para garantir caminho direto abaixo de 1 segundo.
- [x] Criar benchmark semântico com orçamento de 4 segundos.
- [x] Criar benchmark de mensagem sem anexo com e sem histórico.
- [x] Criar benchmark de pergunta e flashcard com embedding ignorado no caminho direto.
- [x] Documentar que o alvo de 4 segundos é somente retrieval; geração do LLM possui orçamento separado.
- [x] Rodar `npm run test:chat`, `npm run typecheck` e `npm run build`.

### Task 10: Integração visual do flashcard no frontend

**Status:** concluída.

- [x] Exibir o botão “Tirar dúvida com IA” no modal de resposta.
- [x] Anexar o flashcard ao contexto global do chat.
- [x] Selecionar automaticamente o monitor e a matéria do flashcard.
- [x] Exibir “Flashcard anexado” acima da mensagem enviada.
- [x] Restaurar o indicador ao carregar o histórico do Redis.
- [x] Enviar somente a referência do flashcard para a API.
- [x] Validar frontend com 21 testes e TypeScript.

## Pendências consolidadas

- [ ] Executar `EXPLAIN (ANALYZE, BUFFERS)` com PostgreSQL local disponível.
- [ ] Melhorar o caminho sem anexo para reduzir a latência do embedding remoto.
- [ ] Implementar query rewriting seletivo e decomposição de consultas.
- [ ] Implementar streaming SSE.
- [ ] Avaliar exposição de citações/fontes no frontend.
- [ ] Extrair o chat para serviço independente quando houver necessidade de escala.
