# Chat AI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar o chat autenticado ao OpenRouter através de um gateway substituível e usar o histórico temporário do Redis em cada geração.

**Architecture:** `ChatService` orquestrará autorização, histórico Redis, prompt e geração. `OpenRouterChatGateway` implementará `ChatGenerationPort`, sem conhecer HTTP público ou Redis. A rota usará a composição do módulo e retornará a resposta final.

**Tech Stack:** TypeScript, Fastify, Zod, ioredis, OpenRouter HTTP API, Node test runner, tsx.

**Spec:** `docs/superpowers/specs/2026-09-07-chat-ai-gateway-design.md`

**Status:** implementação V1 concluída. Streaming SSE e extração para serviço externo
continuam como evolução posterior.

## Global Constraints

- O gateway roda dentro da API nesta fase.
- O histórico usa Redis com TTL deslizante de 18000 segundos e no máximo 40 mensagens.
- Nenhuma mensagem de chat será persistida no PostgreSQL.
- A autorização acontece antes de Redis ou IA.
- O frontend continua usando o endpoint público existente.
- A chave do provedor nunca aparece em logs ou respostas HTTP.
- Streaming SSE e RAG de documentos ficam fora desta implementação.

---

### Task 1: Definir contrato de prompt e extensão textual do OpenRouter

**Files:**
- Modify: `src/modules/chat/ports/chat-generation.port.ts`
- Create: `src/modules/chat/models/chat-generation.model.ts`
- Create: `src/modules/chat/services/chat-prompt.builder.ts`
- Create: `src/modules/chat/services/__tests__/chat-prompt.builder.test.ts`
- Modify: `src/worker/client/openrouter.client.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`

**Interfaces:**
- `ChatGenerationInput` recebe mensagem, histórico, contexto autorizado, monitorId e subjectId.
- `ChatPromptBuilder.build(input)` retorna mensagens `{ role: 'system'|'user'|'assistant', content: string }[]`.
- `OpenRouterClient.createChatCompletion(input)` retorna `{ content: string; usage?: ... }`.

- [ ] **Step 1: Write the failing prompt-builder test** para histórico cronológico, contexto delimitado e mensagem atual como última mensagem do usuário.
- [ ] **Step 2: Run `node --import tsx --test src/modules/chat/services/__tests__/chat-prompt.builder.test.ts`** e confirmar falha por contrato ausente.
- [ ] **Step 3: Implementar tipos e builder mínimo**, limitando o contexto textual aos dados já autorizados.
- [ ] **Step 4: Rodar o teste focado** e confirmar aprovação.
- [ ] **Step 5: Escrever teste falho do método textual do OpenRouter** verificando payload, modelo, tokens, temperatura e timeout.
- [ ] **Step 6: Implementar o método textual reutilizando o tratamento de erros existente** sem expor corpo bruto ao chamador.
- [ ] **Step 7: Rodar os testes do cliente OpenRouter e typecheck**.

### Task 2: Implementar `OpenRouterChatGateway`

**Files:**
- Create: `src/modules/chat/providers/openrouter-chat.gateway.ts`
- Create: `src/modules/chat/providers/__tests__/openrouter-chat.gateway.test.ts`

**Interfaces:**
- Constructor recebe um cliente com `createChatCompletion` e configuração explícita.
- `generate(input)` implementa `ChatGenerationPort` e retorna somente `{ content }`.

- [ ] **Step 1: Escrever teste falho** para transformar o contrato de geração em mensagens e devolver conteúdo normalizado.
- [ ] **Step 2: Executar o teste focado** e verificar falha porque o provider não existe.
- [ ] **Step 3: Implementar o adapter** delegando prompt ao builder e chamada ao cliente.
- [ ] **Step 4: Adicionar testes** para resposta vazia, timeout e erro de provider.
- [ ] **Step 5: Rodar os testes do gateway** e confirmar todos verdes.

### Task 3: Integrar Redis e gateway no caso de uso

**Files:**
- Modify: `src/modules/chat/services/chat.service.ts`
- Modify: `src/modules/chat/chat.module.ts`
- Modify: `src/modules/chat/services/__tests__/chat.service.test.ts`

**Interfaces:**
- `ChatService` recebe `ChatHistoryPort` e `ChatGenerationPort`.
- `sendMessage` lê histórico, salva aluno, gera resposta, salva assistente e retorna ambos.

- [ ] **Step 1: Criar double de `ChatHistoryPort` nos testes**.
- [ ] **Step 2: Escrever testes falhos** para leitura do histórico, append do aluno, append da resposta e falha sem resposta assistente.
- [ ] **Step 3: Implementar o fluxo mínimo no `ChatService`** usando limite 40 e contexto de questão.
- [ ] **Step 4: Rodar `npm run test:chat`** e corrigir somente regressões relacionadas ao contrato.
- [ ] **Step 5: Atualizar a composição do módulo** para aceitar history e gateway.

### Task 4: Conectar a rota pública ao módulo real

**Files:**
- Modify: `src/modules/chat/chat.routes.ts`
- Modify: `src/modules/chat/chat.module.ts`
- Create or modify: `src/modules/chat/__tests__/chat.routes.test.ts`

- [ ] **Step 1: Escrever teste falho** que espera `200` com resposta gerada em vez de `501`.
- [ ] **Step 2: Construir a composição real** com autorização Prisma, Redis repository, prompt builder e OpenRouter gateway.
- [ ] **Step 3: Fazer a rota enviar contexto autorizado ao caso de uso**, sem repetir lógica de persistência nela.
- [ ] **Step 4: Mapear `CHAT_GENERATION_FAILED`, timeout e erro de provider para respostas HTTP estáveis.**
- [ ] **Step 5: Rodar testes de rota e `npm run typecheck`.**

### Task 5: Verificação operacional e documentação

**Files:**
- Modify: `src/modules/chat/README.md`
- Modify: `.env.example`

- [ ] **Step 1: Documentar o ciclo Redis → gateway → Redis e as variáveis do chat.**
- [ ] **Step 2: Rodar `npm run test:chat`.**
- [ ] **Step 3: Rodar `npm run typecheck`.**
- [ ] **Step 4: Rodar `npm run build`.**
- [ ] **Step 5: Executar `git diff --check` e revisar o diff do gateway.**
