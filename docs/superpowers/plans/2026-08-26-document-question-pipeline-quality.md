# Document Question Pipeline Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aumentar a recuperação e a completude das questões extraídas sem perder validação, contexto ou rastreabilidade.

**Architecture:** Corrigir a promoção de candidatas, aplicar fallback de tópicos e tornar a conclusão estruturada resiliente. O parser Docling será corrigido separadamente no repositório do serviço.

**Tech Stack:** TypeScript, Node.js, Prisma/Postgres, Zod, OpenRouter, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-document-question-pipeline-quality-design.md`

## Global Constraints

- `REVIEW_REQUIRED` é revisão humana normal, não falha.
- Não apagar fontes nem o PDF original.
- Toda alteração comportamental deve ter teste antes da implementação.
- Candidatas sem contexto recuperável permanecem bloqueadas.
- Subagentes usam `gpt-5.4-mini` low; fallback `gpt-5.6-luna` low.

### Task 1: Promoção orientada por contexto

**Files:** `src/worker/services/question-extraction.service.ts` e testes correspondentes.

- [x] Teste falhando para continuar/reconstruir candidatas com chunks de evidência.
- [x] Implementação mínima preservando bloqueios irrecuperáveis.
- [x] Testes focados e typecheck.

### Task 2: Fallback de tópicos e status

**Files:** serviços de classificação/persistência e testes correspondentes.

- [x] Teste falhando para fallback quando não há tópico principal.
- [x] Implementação e teste focado.

### Task 3: Conclusão de gabarito e explicação

**Files:** `src/worker/services/completeQuestion/`, cliente OpenRouter e testes.

- [x] Testes para resposta vazia, truncada e schema inválido.
- [x] Implementação de prompts compactos, fallback e validação.
- [x] Testes focados e typecheck.

### Task 4: Telemetria e verificação integrada

- [x] Logs agregados de promoção, retenção, campos ausentes e fallbacks.
- [x] Testes backend e contratos do parser.
- [ ] Reprocessamento do PDF e comparação com baseline.
