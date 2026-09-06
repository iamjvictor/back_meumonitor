# Flashcard Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar e persistir flashcards rastreáveis a partir de chunks elegíveis de documentos com tag `FLASHCARDS`.

**Architecture:** O worker executará seleção determinística, geração JSON estruturada, validação local, deduplicação por `frontHash` e persistência em `flashcards`/`flashcard_sources`. O LLM gera e revisa conteúdo, mas não controla o fluxo.

**Tech Stack:** TypeScript, Fastify worker, Prisma/Postgres, OpenRouter, Zod, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-27-flashcard-generation-design.md`

## Global Constraints

- Reutilizar `FlashcardKind`, `FlashcardStatus`, `FlashcardGenerationOrigin` e `FlashcardSource` existentes.
- Usar `openai/gpt-5-mini` como modelo textual principal e `google/gemini-3.7-flash` como fallback configurável.
- Gerar no máximo cinco cards por chunk.
- Persistir somente como `PENDING_REVIEW`.
- Toda persistência deve incluir vínculo a um chunk de origem.
- Falha de um chunk não pode abortar o documento inteiro.

### Task 1: Contrato, elegibilidade e validação determinística

**Files:**
- Create: `src/worker/services/flashcard/flashcard.types.ts`
- Create: `src/worker/services/flashcard/flashcard-quality.service.ts`
- Test: `src/worker/services/__tests__/flashcard-quality.service.test.ts`

**Interfaces:**
- `isFlashcardEligible(blockType: string, text: string): boolean`
- `validateFlashcardCandidate(candidate, sourceText): { valid: boolean; reason?: string }`
- `computeFlashcardFrontHash(front: string): string`

- [ ] Escrever testes falhando para elegibilidade de THEORY/DEFINITION/FORMULA/EXAMPLE, rejeição de texto curto, card vazio, frente igual ao verso e evidência ausente.
- [ ] Executar `node --import tsx --test src/worker/services/__tests__/flashcard-quality.service.test.ts` e confirmar falha por contrato ausente.
- [ ] Implementar tipos, filtros, normalização e hash usando os limites do schema da especificação.
- [ ] Executar o teste novamente e confirmar aprovação.

### Task 2: Geração estruturada e persistência rastreável

**Files:**
- Create: `src/worker/services/flashcard/flashcard-generation.service.ts`
- Modify: `src/repositories/document-worker.repository.ts`
- Test: `src/worker/services/__tests__/flashcard-generation.service.test.ts`

**Interfaces:**
- `generateForChunk(chunkId: string): Promise<{ generated: number; persisted: number; rejected: number }>`
- `persistCandidates(candidates, context): Promise<number>`

- [ ] Escrever teste falhando para salvar card válido com `PENDING_REVIEW` e `flashcard_sources`.
- [ ] Executar o teste e confirmar falha antes do serviço existir.
- [ ] Implementar prompt/schema estruturado, chamada pelo cliente existente, validação e persistência com `FlashcardGenerationOrigin.AI_GENERATED`.
- [ ] Implementar deduplicação determinística por `topicId + frontHash`.
- [ ] Executar testes focados e confirmar aprovação.

### Task 3: Integrar o job do documento `FLASHCARDS`

**Files:**
- Modify: `src/worker/services/document-worker.service.ts`
- Modify: `src/worker/services/flashcard/flashcard-generation.service.ts`
- Test: `src/worker/services/__tests__/document-worker.service.test.ts`

- [ ] Escrever teste falhando que exige geração de flashcards para `FLASHCARDS` e que mantém extração de questões pulada nessa tag.
- [ ] Executar o teste e confirmar falha.
- [ ] Substituir o `skip` de `GENERATE_FLASHCARD_CANDIDATES` por execução do serviço após embeddings; processar chunks elegíveis com limite de concorrência configurado.
- [ ] Registrar falhas por chunk no `outputSummary` e manter o restante do documento processável.
- [ ] Executar testes focados e confirmar aprovação.

### Task 4: Configuração e verificação final

**Files:**
- Modify: `.env.example`
- Modify: `src/config/env.ts`
- Modify: `src/config/ai-models.config.ts`

- [ ] Adicionar modelos e limites de flashcard sem expor chaves.
- [ ] Executar `npm run typecheck`.
- [ ] Executar `node --import tsx --test src/worker/services/__tests__/flashcard-quality.service.test.ts src/worker/services/__tests__/flashcard-generation.service.test.ts src/worker/services/__tests__/document-worker.service.test.ts`.
- [ ] Verificar manualmente que o worker registra o job de flashcards e que a saída inclui quantidade gerada, rejeitada e persistida.
