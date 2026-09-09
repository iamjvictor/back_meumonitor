# Chat RAG Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recuperar conhecimento autorizado para enriquecer o contexto do chat antes da chamada ao gateway de IA.

**Architecture:** O RAG ficará em `src/modules/chat/rag/` e será chamado pelo `ChatService`. O Redis será lido fora do RAG e seu histórico será passado como contrato. O provider reutilizará embeddings e `KnowledgeRetrievalService` existentes.

**Tech Stack:** TypeScript, Redis, OpenRouter embeddings, PostgreSQL/pgvector, busca lexical, `KnowledgeRetrievalService`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-chat-rag-service-design.md`

**Status atual:** Fases 0 a 6 concluídas. O fast path oficial de questões e flashcards foi
implementado posteriormente e está documentado em `2026-09-07-chat-rag-question-fast-path-design.md`.

> [!IMPORTANT]
> **CONTINUAR AMANHÃ:** começar pelo benchmark SQL das evidências oficiais e pela otimização
> do retrieval sem anexo.

## Resumo de execução

### Concluído

- Contratos do RAG, consulta determinística e retrieval híbrido.
- Montagem de contexto, integração no `ChatService` e gateway OpenRouter.
- Histórico temporário no Redis com TTL deslizante e limite de mensagens.
- Autorização de questões, tentativas e fontes oficiais.
- Fast path de questões com `QuestionSource`, sem embedding quando suficiente.
- Fast path de flashcards aprovados com `FlashcardSource`, sem embedding quando suficiente.
- Cache de evidências no Redis para questões e flashcards.
- Continuidade de conversa usando o último anexo válido do histórico.
- Logs operacionais e sinal de qualidade da recuperação.
- Integração frontend para anexar questão ou flashcard ao chat.

### Próximas fases

- Otimizar o caminho sem anexo e medir p95 de geração/retrieval.
- Query rewriting seletivo e decomposição de consultas.
- Avaliação automática de qualidade, groundedness e relevância das fontes.
- Streaming SSE.
- Extração futura do chat para serviço independente, quando houver necessidade de escala.

## Global Constraints

- O RAG roda dentro da API na V1.
- O RAG não acessa Redis diretamente.
- O retrieval deve filtrar por `teacherId`, `monitorId` e `subjectId`.
- O histórico tem no máximo 40 registros e a consulta usa inicialmente as últimas 6 mensagens relevantes.
- A busca deve reutilizar `KnowledgeRetrievalService` e `searchReadyKnowledgeChunks`.
- Falha de retrieval é não bloqueante; falha de geração impede salvar resposta assistente.
- Não criar Chroma, LangChain ou novo deploy.

---

### Fase 0 — Contratos e escopo autorizado

**Arquivos:**
- Criar: `src/modules/chat/rag/models/chat-rag.model.ts`
- Criar: `src/modules/chat/rag/ports/chat-knowledge.port.ts`
- Modificar: `src/modules/chat/models/chat-generation.model.ts`
- Modificar: `src/modules/chat/services/chat.service.ts`
- Testar: `src/modules/chat/rag/__tests__/chat-rag.contract.test.ts`

- [x] Definir `ChatRagInput`, `ChatRagResult` e `ChatRagCitation`.
- [x] Integrar o `ChatRagService` ao `ChatService` na Fase 4, mantendo o histórico já lido do Redis fora do RAG.
- [x] Garantir que o contrato não contenha a conexão Redis.
- [x] Incluir `teacherId` apenas como dado derivado pelo backend.
- [x] Testar que as últimas 6 mensagens são selecionadas para a consulta sem apagar o histórico completo.

### Fase 1 — Construção determinística da consulta

**Arquivos:**
- Criar: `src/modules/chat/rag/services/chat-query.builder.ts`
- Criar: `src/modules/chat/rag/services/__tests__/chat-query.builder.test.ts`

- [x] Escrever teste para mensagem comum sem questão.
- [x] Escrever teste para questão anexada e histórico com referência anafórica.
- [x] Implementar consulta com mensagem, questão oficial, tópico e últimas 6 mensagens.
- [x] Remover IDs, credenciais e conteúdo desnecessário da consulta de embedding.
- [x] Validar limite de caracteres da consulta.

### Fase 2 — Provider de embedding e retrieval híbrido

**Arquivos:**
- Criar: `src/modules/chat/rag/providers/knowledge-retrieval-chat.provider.ts`
- Criar: `src/modules/chat/rag/providers/__tests__/knowledge-retrieval-chat.provider.test.ts`

- [x] Escrever teste com clientes falsos para embedding e retrieval.
- [x] Confirmar que o embedding é gerado uma única vez por consulta.
- [x] Confirmar que o retrieval recebe `teacherId`, `monitorId`, `subjectId`, `topicId` e consulta textual.
- [x] Reutilizar o limite de até 8 evidências selecionadas.
- [x] Mapear candidatos para `ChatRagCitation` sem vazar dados de autorização.
- [x] Implementar fallback `used: false` quando embedding ou busca falhar.

### Fase 3 — Montagem do contexto RAG

**Arquivos:**
- Criar: `src/modules/chat/rag/services/chat-context.assembler.ts`
- Criar: `src/modules/chat/rag/services/__tests__/chat-context.assembler.test.ts`
- Modificar: `src/modules/chat/services/chat-prompt.builder.ts`

- [x] Testar delimitadores para questão, histórico, evidências e dúvida atual.
- [x] Limitar o contexto por caracteres e tokens estimados.
- [x] Deduplicar evidências pelo bloco pai ou chunk.
- [x] Marcar ausência de evidências de forma explícita.
- [x] Garantir que conteúdo documental permaneça dentro da mensagem `user`, nunca dentro do prompt `system`.

### Fase 4 — Orquestração no ChatService

**Arquivos:**
- Criar: `src/modules/chat/rag/services/chat-rag.service.ts`
- Modificar: `src/modules/chat/services/chat.service.ts`
- Modificar: `src/modules/chat/chat.module.ts`
- Modificar: `src/modules/chat/providers/openrouter-chat.gateway.ts`
- Testar: `src/modules/chat/services/__tests__/chat.service.test.ts`

- [x] Injetar o `ChatRagService` no `ChatService`, usando `ChatKnowledgePort` como adapter de conhecimento.
- [x] Ler histórico Redis uma vez por mensagem.
- [x] Executar RAG antes do gateway.
- [x] Passar contexto RAG ao `ChatGenerationPort`.
- [x] Manter fallback sem evidências quando o RAG falhar.
- [x] Salvar resposta assistente no Redis somente após geração bem-sucedida.

### Fase 5 — Validação da questão e fontes

**Arquivos:**
- Modificar: `src/modules/chat/chat.routes.ts`
- Criar: `src/modules/chat/rag/providers/__tests__/question-source-scope.test.ts`
- Modificar: `src/modules/chat/models/chat-generation.model.ts`

- [x] Validar `questionAttemptId` contra o aluno autenticado.
- [x] Confirmar `selectedOption` pela tentativa oficial quando houver tentativa.
- [x] Buscar `teacherId` derivado do monitor ou da questão.
- [x] Buscar `QuestionSource` para restringir o retrieval ao documento e bloco de origem.
- [x] Evitar que uma questão de outro escopo alcance o retrieval.

### Fase 6 — Observabilidade e avaliação

**Arquivos:**
- Modificar: `src/modules/chat/README.md`
- Criar: `src/modules/chat/rag/__tests__/chat-rag.observability.test.ts`
- Modificar: `docs/superpowers/specs/2026-09-07-chat-rag-service-design.md` se os limites forem ajustados por evidência.

- [x] Registrar início, embedding, retrieval, montagem e falha não bloqueante.
- [x] Não registrar histórico integral nem conteúdo sensível.
- [x] Medir candidatos, selecionados, duração e score agregado.
- [x] Criar casos de avaliação com perguntas e chunks esperados.
- [x] Rodar `npm run test:chat`, `npm run typecheck`, `npm run build` e `git diff --check` antes de considerar a fase concluída.
