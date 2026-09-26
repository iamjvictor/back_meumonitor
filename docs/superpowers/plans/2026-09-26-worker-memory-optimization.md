# Worker Memory Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer and reviewer must use `gpt-5.6-luna`.

**Goal:** Reduzir memória permanente e picos do worker removendo retenções, reutilizando o layout Docling, controlando concorrência e carregando componentes pesados apenas quando necessários.

**Architecture:** O adaptador mantém somente requests em andamento; o worker emite snapshots sem histórico local; o layout normalizado é projetado para `ParsedPdfText` e substitui PDF.js no modo Docling. O caminho PDF.js permanece como rollback explícito e recebe cleanup completo.

**Tech Stack:** Node.js 22, TypeScript ESM, BullMQ, ioredis, Prisma, Supabase, Zod, `node:test`, `tsx`, Docling HTTP.

**Specs:**
- `docs/superpowers/specs/2026-09-26-worker-memory-foundation-design.md`
- `docs/superpowers/specs/2026-09-26-worker-docling-memory-pipeline-design.md`
- `docs/superpowers/specs/2026-09-26-worker-memory-tdd-workflow.md`

## Global Constraints

- Não alterar Dockerfile, PyTorch, CUDA, imagem ou topologia de containers.
- Preservar concorrência default de documentos em `2`, simulados em `2` e pagamentos em `4`.
- Não criar fallback implícito Docling → PDF.js.
- Não mudar limiares de qualidade textual: 80 caracteres/página e 0,5% de `U+FFFD`.
- Nenhuma implementação sem teste RED observado e registrado.
- Testes determinísticos não acessam LLM, Redis, PostgreSQL, Supabase ou parser real.
- Cada tarefa usa um implementador Luna e outro Luna como revisor; o agente que implementa não aprova o próprio diff.
- Alterações locais preexistentes em `.env.example`, `src/config/__tests__/cors.test.ts` e outros arquivos fora da tarefa devem ser preservadas.

## Review Focus

- Timeout deve abortar o `fetch`, não apenas rejeitar `Promise.race`; Task 1 testa o signal.
- Resultado inline deve ser persistido sem cache local; Task 1 testa restart/retry pelo store.
- Página somente com figura deve manter evidência visual e texto vazio; Task 3 testa esse caso.
- Configuração inválida deve falhar antes de abrir conexões; Task 6 usa processo filho.
- Falha de lazy initialization deve limpar a Promise e permitir nova tentativa; Task 7 testa concorrência e retry.

---

### Task 1: Remover retenção do adaptador e cancelar requests

**Files:**
- Modify: `src/worker/services/document-parser/document-parser.adapter.ts`
- Modify: `src/worker/services/document-parser/mineru-parser.adapter.ts`
- Modify: `src/worker/services/document-parser/document-parse-orchestrator.service.ts`
- Test: `src/worker/services/document-parser/__tests__/mineru-parser.adapter.test.ts`
- Test: `src/worker/services/document-parser/__tests__/document-parse-orchestrator.service.test.ts`

**Interfaces:**
- Produces: `ParseExecutionOptions`, `DocumentParserAdapter.parse(input, options?)`, `MineruParserAdapter.close()`.
- Preserves: `ParseSubmission.result` como transporte inline e deduplicação por idempotency key.

- [ ] **Step 1: Escrever testes RED de retenção e deduplicação**

Adicionar testes com 100 respostas inline, chamadas concorrentes equivalentes, erro HTTP e JSON inválido. Asserções: uma chamada HTTP por chave e nenhuma entrada interna após settlement. O teste deve falhar porque `inlineResults` retém dados.

- [ ] **Step 2: Executar RED**

```bash
node --import tsx --test src/worker/services/document-parser/__tests__/mineru-parser.adapter.test.ts
```

Expected: FAIL na asserção de resultado retido ou API de inspeção/ciclo de vida ainda inexistente.

- [ ] **Step 3: Escrever teste RED de abort real**

Criar fetch pendente que observa `AbortSignal`; timeout e `close()` devem abortá-lo, liquidar a Promise e permitir mapa vazio. Confirmar falha pela ausência de propagação do signal.

- [ ] **Step 4: Implementar GREEN mínimo**

Remover `inlineResults`; armazenar `{ promise, controller }` apenas durante execução; propagar signal; implementar `close`; ajustar orquestrador para consumir `submission.result` e cancelar timeout.

- [ ] **Step 5: Executar gate da tarefa**

```bash
npm run test:document-parser-unit
node --import tsx --test src/worker/services/document-parser/__tests__/document-parse-orchestrator.service.test.ts
npm run test:document-parser-persistence-contract
npm run typecheck
npm run lint -- --quiet
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/worker/services/document-parser
git commit -m "fix: release completed parser results"
```

---

### Task 2: Adicionar tracker e telemetria de memória

**Files:**
- Create: `src/health/worker-memory.ts`
- Create: `src/health/__tests__/worker-memory.test.ts`
- Modify: `src/worker.ts`
- Modify: `src/worker/services/document-worker.service.ts`
- Test: `src/health/__tests__/worker-health.test.ts`

**Interfaces:**
- Consumes: parser encerrável produzido pela Task 1.
- Produces: `WorkerJobTracker`, `WorkerMemoryEvent`, `createWorkerMemoryMonitor()`.

- [ ] **Step 1: Escrever testes RED do tracker**

Testar duas actions controladas, conclusão, rejection e snapshots imutáveis. Asserções exatas: sequência de `active` 0→2→1→0; `started=2`; completed/failed corretos; nunca negativo.

- [ ] **Step 2: Escrever testes RED do monitor**

Injetar clock, `memoryUsage` e logger. Verificar todos os campos, sample no boot/estágio, `unref`, stop, ausência de histórico e falha do logger sem propagação.

- [ ] **Step 3: Executar RED**

```bash
node --import tsx --test src/health/__tests__/worker-memory.test.ts
```

Expected: FAIL porque o módulo não existe.

- [ ] **Step 4: Implementar GREEN mínimo**

Criar tracker e monitor puros. Envolver processors BullMQ com `tracker.run`. Instrumentar fronteiras de download, parse, persistência, conclusão e erro sem incluir conteúdo sensível.

- [ ] **Step 5: Executar gate da tarefa**

```bash
node --import tsx --test src/health/__tests__/worker-health.test.ts src/health/__tests__/worker-memory.test.ts
node --import tsx --experimental-test-module-mocks --test src/worker/services/__tests__/document-worker.service.test.ts
npm run typecheck
npm run lint -- --quiet
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/health src/worker.ts src/worker/services/document-worker.service.ts
git commit -m "feat: observe worker memory by processing stage"
```

---

### Task 3: Projetar LayoutDocument para ParsedPdfText

**Files:**
- Create: `src/worker/services/document-parser/layout-text-projection.service.ts`
- Create: `src/worker/services/document-parser/__tests__/layout-text-projection.service.test.ts`
- Modify: `src/worker/services/document-text-extraction.service.ts`
- Create or modify test: `src/worker/services/__tests__/document-text-extraction.service.test.ts`

**Interfaces:**
- Produces: `DocumentTextSourceMetadata`, `projectLayoutDocumentToParsedPdfText(layout)`.
- Consumers later: `DocumentIngestionV3Service` e `DocumentWorkerService` na Task 4.

- [ ] **Step 1: Escrever testes RED da projeção**

Cobrir ordem/desempate, página vazia, página só com figura, normalized/raw/html, fórmula, tabela HTML, assets duplicados, separadores e não mutação. Usar fixture pequena construída no teste.

- [ ] **Step 2: Executar RED**

```bash
node --import tsx --test src/worker/services/document-parser/__tests__/layout-text-projection.service.test.ts
```

Expected: FAIL porque a função não existe.

- [ ] **Step 3: Implementar GREEN mínimo**

Implementar projeção pura segundo a spec, incluindo conversão HTML determinística e metadados de origem. Não acessar banco, storage ou parser.

- [ ] **Step 4: Escrever RED de procedência/qualidade**

Testar `qualityDetails` Docling e os quatro estados com os limiares existentes, além de remoção de null e warnings que não rebaixam texto bom.

- [ ] **Step 5: Implementar procedência sem mudar limiares**

Permitir que `DocumentTextExtractionService` persista metadados da fonte, mantendo comportamento PDF.js quando source estiver ausente.

- [ ] **Step 6: Executar gate da tarefa**

```bash
node --import tsx --test \
  src/worker/services/document-parser/__tests__/layout-text-projection.service.test.ts \
  src/worker/services/__tests__/document-text-extraction.service.test.ts
npm run test:document-parser-layout-contract
npm run typecheck
npm run lint -- --quiet
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add src/worker/services/document-parser/layout-text-projection.service.ts src/worker/services/document-parser/__tests__/layout-text-projection.service.test.ts src/worker/services/document-text-extraction.service.ts src/worker/services/__tests__/document-text-extraction.service.test.ts
git commit -m "feat: project Docling layout into document text"
```

---

### Task 4: Integrar Docling como fonte textual sem fallback implícito

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `src/worker/services/document-parser/document-ingestion-v3.service.ts`
- Modify: `src/worker/services/document-worker.service.ts`
- Test: `src/worker/services/document-parser/__tests__/document-parse-orchestrator.service.test.ts`
- Test: `src/worker/services/__tests__/document-worker.service.test.ts`
- Test: `src/scripts/test-document-parser-layout-contract.ts`

**Interfaces:**
- Consumes: projeção da Task 3.
- Produces: `DocumentIngestionV3Result.parsedPdf` e `DOCUMENT_TEXT_SOURCE` validado.

- [ ] **Step 1: Escrever RED de ingestão**

Testar resultado inline e remoto retornando `parsedPdf`, warnings preservados e `COMPLETED` sem layout/projeção produzindo `DOCLING_LAYOUT_PROJECTION_MISSING`.

- [ ] **Step 2: Escrever RED do worker**

Injetar extrator PDF.js que lança ao ser chamado. No modo Docling, job completo deve usar a projeção e não chamar o extrator; fallback do parser deve falhar sem chamar PDF.js. No modo legado, o extrator deve ser chamado uma vez.

- [ ] **Step 3: Executar RED**

```bash
node --import tsx --experimental-test-module-mocks --test src/worker/services/__tests__/document-worker.service.test.ts
```

Expected: FAIL porque o fluxo ainda chama PDF.js após Docling.

- [ ] **Step 4: Implementar GREEN mínimo**

Retornar projeção pela ingestão, selecionar fonte no worker e validar combinações de env antes de abrir conexões.

- [ ] **Step 5: Executar gate da tarefa**

```bash
npm run test:document-parser-unit
npm run test:document-parser-layout-contract
npm run test:document-ingestion-v3
node --import tsx --experimental-test-module-mocks --test src/worker/services/__tests__/document-worker.service.test.ts
npm run typecheck
npm run lint -- --quiet
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add .env.example src/config/env.ts src/worker/services/document-parser src/worker/services/document-worker.service.ts src/worker/services/__tests__/document-worker.service.test.ts src/scripts/test-document-parser-layout-contract.ts
git commit -m "feat: consume Docling layout in document worker"
```

---

### Task 5: Garantir cleanup do PDF.js e transporte transitório

**Files:**
- Modify: `src/worker/services/pdf-layout-extraction.service.ts`
- Create: `src/worker/services/__tests__/pdf-layout-extraction.service.test.ts`
- Modify: `src/worker/services/document-parser/mineru-parser.adapter.ts`
- Test: `src/worker/services/document-parser/__tests__/mineru-parser.adapter.test.ts`

**Interfaces:**
- Preserves: `extractPdfPagesWithLayout(data): Promise<LayoutPage[]>`.
- Adds only test seams needed to inject/load PDF.js without importing it in Docling mode.

- [ ] **Step 1: Escrever RED de cleanup**

Testar destroy/cleanup em sucesso, erro de abertura, erro de texto e erro de operadores; cada recurso é liberado uma vez.

- [ ] **Step 2: Escrever RED de multipart/retry**

Capturar `FormData` em duas tentativas e verificar nome, MIME, bytes completos e hash de entrada inalterado.

- [ ] **Step 3: Executar RED**

```bash
node --import tsx --test src/worker/services/__tests__/pdf-layout-extraction.service.test.ts src/worker/services/document-parser/__tests__/mineru-parser.adapter.test.ts
```

- [ ] **Step 4: Implementar GREEN mínimo**

Adicionar `finally` por documento/página, manter import dinâmico e remover conversão intermediária apenas se os testes provarem equivalência da API Blob.

- [ ] **Step 5: Executar gate da tarefa**

```bash
npm run test:document-parser-unit
node --import tsx --test src/worker/services/__tests__/pdf-layout-extraction.service.test.ts
npm run test:document-parser-contract
npm run typecheck
npm run lint -- --quiet
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/worker/services/pdf-layout-extraction.service.ts src/worker/services/__tests__/pdf-layout-extraction.service.test.ts src/worker/services/document-parser/mineru-parser.adapter.ts src/worker/services/document-parser/__tests__/mineru-parser.adapter.test.ts
git commit -m "fix: release legacy PDF resources"
```

---

### Task 6: Configurar concorrência e tornar wiring testável

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/worker/worker-options.ts`
- Create: `src/worker/__tests__/worker-options.test.ts`
- Modify: `src/worker.ts`

**Interfaces:**
- Produces: `createDocumentWorkerOptions(connection, concurrency)`.
- Consumes: monitor/tracker da Task 2.

- [ ] **Step 1: Escrever RED do env em processo filho**

Testar default `2`, valor `1`, e rejeição de `0`, fração e `9`, isolando o singleton `env.ts` em subprocessos.

- [ ] **Step 2: Escrever RED da factory**

Asserir que a factory usa a conexão fornecida e concorrência efetiva; log de ready deve usar o mesmo valor.

- [ ] **Step 3: Implementar GREEN mínimo**

Adicionar env e factory; substituir constantes somente na fila de documentos.

- [ ] **Step 4: Executar gate da tarefa**

```bash
node --import tsx --test src/worker/__tests__/worker-options.test.ts
npm run typecheck
npm run lint -- --quiet
npm run build
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add .env.example src/config/env.ts src/worker.ts src/worker/worker-options.ts src/worker/__tests__/worker-options.test.ts
git commit -m "feat: configure document worker concurrency"
```

---

### Task 7: Carregar serviço de documentos sob demanda

**Files:**
- Create: `src/worker/document-worker-loader.ts`
- Create: `src/worker/__tests__/document-worker-loader.test.ts`
- Modify: `src/worker.ts`
- Modify: `src/worker/services/chunk.service.ts` only if tokenizer can be delayed without changing synchronous public contracts
- Test: `src/worker/services/__tests__/chunk.service.test.ts`

**Interfaces:**
- Produces: `createDocumentWorkerServiceLoader(factory)` returning `() => Promise<DocumentWorkerService>`.

- [ ] **Step 1: Escrever RED do loader**

Testar que duas chamadas concorrentes inicializam uma vez, chamadas posteriores reutilizam a instância e falha limpa a Promise para retry.

- [ ] **Step 2: Escrever RED de import pesado**

Usar processo filho/sentinel para comprovar que boot de módulo leve não carrega PDF.js antes do primeiro documento e que modo Docling nunca o carrega.

- [ ] **Step 3: Implementar GREEN mínimo**

Mover import/instanciação do serviço de documentos para o loader. Adiar tokenizador somente se a API continuar compatível; caso exija tornar funções síncronas em assíncronas, registrar ruling e manter tokenizador estático nesta entrega.

- [ ] **Step 4: Executar gate da tarefa**

```bash
node --import tsx --test src/worker/__tests__/document-worker-loader.test.ts src/worker/services/__tests__/chunk.service.test.ts
npm run test:documents
npm run test:chunk-quality
npm run typecheck
npm run lint -- --quiet
npm run build
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts src/worker/document-worker-loader.ts src/worker/__tests__/document-worker-loader.test.ts src/worker/services/chunk.service.ts src/worker/services/__tests__/chunk.service.test.ts
git commit -m "perf: load document pipeline on demand"
```

---

### Task 8: Regressão completa e relatório de memória

**Files:**
- Create: `docs/performance/worker-memory-baseline.md`
- Modify tests/fixtures only if a missing documented corpus case requires it.

**Interfaces:**
- Consumes all tasks; produces evidence de liberação.

- [ ] **Step 1: Executar gate determinístico completo**

Usar os comandos da spec TDD. Registrar versões, duração e exit codes. Corrigir qualquer regressão pelo loop RED-GREEN da tarefa proprietária.

- [ ] **Step 2: Executar corpus Docling em homologação**

Validar duas colunas, fórmulas, tabelas, figura, página vazia, texto normalizado e chunks. Não usar fila de produção.

- [ ] **Step 3: Executar protocolo de memória em Node 22**

Medir baseline e candidato com mesmo corpus, container, configuração e concorrência: 5 minutos idle, 10 warmups, 100 jobs em blocos, três repetições.

- [ ] **Step 4: Registrar resultado**

Documentar RSS, heap, external, arrayBuffers, vazão, falhas, crescimento pós-aquecimento e mediana dos picos. Distinguir processo Node de container agregado.

- [ ] **Step 5: Revisão final Luna**

Um Luna que não implementou tarefas revisa toda a branch contra as três specs e o relatório. Findings bloqueantes recebem uma rodada de correção e re-review.

- [ ] **Step 6: Commit**

```bash
git add docs/performance/worker-memory-baseline.md
git commit -m "docs: record worker memory validation"
```

## Execution Notes

- Executar tarefas sequencialmente porque contratos e arquivos são compartilhados.
- Cada tarefa possui workspace/report do SDD e revisão independente.
- O controlador preserva um ledger com commits, RED observado, gates e rulings.
- Não fazer push, merge ou deploy como parte deste plano sem instrução explícita.
