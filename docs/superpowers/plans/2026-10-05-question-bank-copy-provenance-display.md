# Rastreabilidade e identificação de questões copiadas do acervo — Plano de implementação

> **Para agentes de implementação:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa por tarefa. Os passos usam caixas `- [ ]` para acompanhamento.

**Objetivo:** Preservar e expor o rastreio das questões copiadas do acervo, exibir suas imagens na prática e identificar cada questão no cabeçalho com banca (ou nome da prova) e ano.

**Arquitetura:** Manter `Question.questionBankItemId`, `sourceKey` e `Question.metadata` como mecanismos de rastreabilidade. A consulta de prática combina os dados atuais de `QuestionBankItem` com o snapshot de `metadata` como fallback, normaliza isso em `imageUrls` e `provenance`, e a tela mostra imagens e identificação junto ao tópico.

**Stack:** TypeScript, Prisma 7, Fastify, Node test runner + tsx no backend, Next.js 16, React 19 e testes de contrato Node no frontend.

**Spec:** `backend/docs/superpowers/specs/2026-10-05-question-bank-copy-provenance-display-design.md`

## Restrições globais

- Não criar migração: o schema atual já tem FK, snapshot e metadados necessários.
- Não baixar, copiar, espelhar, transformar ou fazer proxy das imagens; usar URLs importadas.
- Retornar `imageUrls: string[]` e `provenance: { board: string | null; examName: string | null; examYear: number | null; sourceUrl: string | null } | null` no contrato de prática.
- Priorizar valores presentes na relação; recorrer ao snapshot de `Question.metadata` quando os dados da relação estiverem ausentes ou vazios.
- Cabeçalho usa `board` se não vazia; senão `examName`; inclui ano apenas quando número válido; omite segmentos vazios.
- Não mudar respostas, autorização, gabarito, explicação, classificação, filtros nem paginação.
- Usar TDD para comportamento novo: escrever teste, rodá-lo para observar a falha esperada, implementar o mínimo e rodar novamente.

## Foco de revisão

1. Array `imageUrls` vazio na relação com imagens válidas no snapshot: o aluno ainda deve ver as URLs do snapshot. Testar no mapper da prática.
2. Metadados parcialmente preenchidos na relação: complementar campos faltantes pelo snapshot sem substituir valores válidos. Testar no mapper da prática.
3. `board` nula ou em branco com `examName` disponível: usar nome de prova; omitir ano se nulo. Testar no contrato do cabeçalho.
4. Questão sem vínculo ao acervo ou com metadados inválidos: retornar valores vazios seguros e não renderizar imagem/rótulo quebrado. Testar no mapper e no frontend.
5. Retry de materialização e materialização em outro monitor: preservar source key idempotente por monitor/item e FK para o item original. Cobrir como teste de caracterização do serviço.

---

## Arquivos e responsabilidades

- Modificar `backend/src/modules/question-bank/services/__tests__/question-bank-materialization.service.test.ts` para fixar com asserts explícitos o contrato de rastreabilidade que o serviço já produz.
- Criar `backend/src/modules/student-question-attempts/services/question-practice-provenance.ts` como mapper puro e testável para normalizar imagens e proveniência, resolvendo relação + snapshot.
- Criar `backend/src/modules/student-question-attempts/services/__tests__/question-practice-provenance.test.ts` para os casos de precedência, fallback, dados parciais e ausência de origem.
- Modificar `backend/src/modules/student-question-attempts/repositories/student-question-attempt.repository.ts` para consultar a relação e `metadata`, mapear cada questão e retornar `imageUrls` e `provenance` no nível superior.
- Criar `backend/src/modules/student-question-attempts/repositories/__tests__/student-question-attempt.repository.test.ts` para exercitar o repositório real com um Prisma fake na fronteira e verificar o payload retornado.
- Criar `frontend/tests/practice-question-provenance-contract.test.mjs` para fixar o contrato do título/cabeçalho, casos de fallback e preservação da renderização de imagem.
- Modificar `frontend/src/app/(student-app)/areadoaluno/pratica/page.tsx` para tipar/consumir o novo contrato e mostrar a identificação no cabeçalho existente.

## Sequência TDD

### Tarefa 1: Fixar o contrato de rastreabilidade da cópia

**Arquivos:**
- Modificar: `backend/src/modules/question-bank/services/__tests__/question-bank-materialization.service.test.ts`
- Produção: sem mudança prevista; o mecanismo já existe e será preservado.

**Interfaces:**
- Entrada existente: `QuestionBankMaterializationService.materialize(input)`.
- Resultado existente: dados enviados a `upsertQuestion`, incluindo `questionBankItemId`, `sourceKey` e `metadata`.

- [ ] **Passo 1: Fortalecer o teste de caracterização existente** com fixture `examName: 'ENEM'`, `examYear: 2008`, `board: null` e URL de imagem, e afirmar exatamente `questionBankItemId === 'item-1'`, `sourceKey === 'question-bank:monitor-1:item-1'`, e os valores em `metadata.imageUrls`, `metadata.board`, `metadata.examName` e `metadata.examYear`.
- [ ] **Passo 2: Rodar o teste de caracterização**

  Executar de `backend/`:

  ```bash
  node --import tsx --test src/modules/question-bank/services/__tests__/question-bank-materialization.service.test.ts
  ```

  Esperado: PASS; confirma que a cópia já preserva esses dados. Se falhar, investigar primeiro se a fixture não representa corretamente o item materializado; a implementação só muda depois de um teste que reproduza a perda.

- [ ] **Passo 3: Completar os asserts de idempotência e escopo entre monitores** no teste existente: retry reutiliza source key; outro monitor produz outra source key enquanto mantém o mesmo `questionBankItemId`.
- [ ] **Passo 4: Rodar novamente o teste de materialização** com o mesmo comando e confirmar PASS.

### Tarefa 2: Normalizar imagens e proveniência com fallback de snapshot

**Arquivos:**
- Criar: `backend/src/modules/student-question-attempts/services/question-practice-provenance.ts`
- Criar: `backend/src/modules/student-question-attempts/services/__tests__/question-practice-provenance.test.ts`

**Interfaces:**
- Produzir `mapQuestionPracticeProvenance(input)` recebendo relação opcional `{ imageUrls, board, examName, examYear, sourceUrl }` e `metadata` não confiável.
- Retornar `{ imageUrls: string[]; provenance: { board: string | null; examName: string | null; examYear: number | null; sourceUrl: string | null } | null }`.
- Remover URLs não string/em branco, aceitar ano apenas como inteiro válido e normalizar strings em branco como `null`.
- Para imagens, usar lista da relação quando não vazia; caso vazia ou ausente, usar lista válida do snapshot.
- Para cada campo da proveniência, preferir valor não vazio/válido da relação e complementar pelo snapshot.

- [ ] **Passo 1: Escrever testes unitários falhos** com estes nomes/asserts:
  - `prefers relation fields and image URLs when present`: relação vence snapshot para valores válidos.
  - `falls back to snapshot when relation values are missing or empty`: lista vazia e strings vazias na relação usam os valores snapshot.
  - `combines partial relation and snapshot metadata`: relação mantém seus campos válidos e snapshot complementa os demais.
  - `returns safe empty values for non-bank questions`: relação e snapshot ausentes retornam `imageUrls: []` e `provenance: null`.
  - `ignores malformed metadata and invalid image URLs`: JSON inválido/inesperado e ano inválido não causam erro nem são devolvidos.
- [ ] **Passo 2: Confirmar RED**

  Executar de `backend/`:

  ```bash
  node --import tsx --test src/modules/student-question-attempts/services/__tests__/question-practice-provenance.test.ts
  ```

  Esperado: falha inicial por módulo/função ausente, não por erro de sintaxe do teste.

- [ ] **Passo 3: Implementar o mapper puro** em `question-practice-provenance.ts`, sem dependência de Prisma ou Fastify.
- [ ] **Passo 4: Confirmar GREEN** executando o mesmo comando; todos os cinco casos devem passar.

### Tarefa 3: Incluir o mapper no payload de prática do aluno

**Arquivos:**
- Modificar: `backend/src/modules/student-question-attempts/repositories/student-question-attempt.repository.ts`
- Criar: `backend/src/modules/student-question-attempts/repositories/__tests__/student-question-attempt.repository.test.ts`
- Teste: `backend/src/modules/student-question-attempts/services/__tests__/question-practice-provenance.test.ts` (mapper)

**Interfaces:**
- Query `question.findMany` seleciona `questionBankItem.imageUrls`, `board`, `examName`, `examYear`, `sourceUrl`, e `metadata` na questão.
- Cada elemento retornado por `listApprovedQuestions` inclui campos superiores `imageUrls` e `provenance`, preservando os outros campos já retornados.

- [ ] **Passo 1: Adicionar um teste de comportamento RED** em `student-question-attempt.repository.test.ts`, usando `t.mock.module` apenas para substituir o delegate Prisma; importar e executar o repositório real, afirmar `imageUrls`/`provenance` no payload, a seleção dos campos necessários, a preservação de `id`/texto/alternativas/tópico e a não exposição do JSON bruto de `metadata`.
- [ ] **Passo 2: Rodar o teste novo e confirmar RED** pelo payload sem `imageUrls`/`provenance` e com `metadata` bruto ainda exposto.

  ```bash
  node --experimental-test-module-mocks --import tsx src/modules/student-question-attempts/repositories/__tests__/student-question-attempt.repository.test.ts
  ```
- [ ] **Passo 3: Alterar a consulta e projeção do repositório** para selecionar os campos de origem e chamar o mapper; não alterar filtros, ordenação, paginação, contadores ou autorização.
- [ ] **Passo 4: Confirmar GREEN** com o teste de comportamento do repositório e o teste unitário do mapper:

  ```bash
  node --import tsx --test src/modules/student-question-attempts/services/__tests__/question-practice-provenance.test.ts
  ```

  Executar o teste de repositório com module mocking habilitado:

  ```bash
  node --experimental-test-module-mocks --import tsx src/modules/student-question-attempts/repositories/__tests__/student-question-attempt.repository.test.ts
  ```

  Esperado: ambos passam. No runner sem `--experimental-test-module-mocks`, o teste do repositório é skipped; o comando focado acima executa suas asserções.

### Tarefa 4: Mostrar banca/prova, ano e imagens no cabeçalho da prática

**Arquivos:**
- Modificar: `frontend/src/app/(student-app)/areadoaluno/pratica/page.tsx`
- Criar: `frontend/src/modules/student/components/PracticeQuestionHeading.tsx`
- Criar: `frontend/tests/unit/PracticeQuestionHeading.test.tsx`
- Criar: `frontend/tests/practice-question-provenance-contract.test.mjs` para garantir que a página usa o cabeçalho testado.

**Interfaces:**
- `RawPracticeQuestion` consome `imageUrls: unknown` e `provenance` com `board`, `examName`, `examYear` e `sourceUrl` opcionais.
- `PracticeQuestion` expõe `imageUrls: string[]` e `provenance` normalizada.
- `PracticeQuestionHeading` renderiza `Questão n de total • tópico • board || examName • examYear` e omite segmentos vazios.

- [ ] **Passo 1: Escrever testes de componente falhos** em `PracticeQuestionHeading.test.tsx` usando Testing Library para renderizar o cabeçalho: ENEM 2008 aparece junto; CESGRANRIO prevalece sobre outro nome; banca ausente usa `examName`; ano ausente é omitido; sem origem não há separador solto.
- [ ] **Passo 2: Confirmar RED** de `frontend/`:

  ```bash
  npm run test:unit -- tests/unit/PracticeQuestionHeading.test.tsx
  ```

  Esperado: falha inicial ao importar o cabeçalho ainda inexistente.

- [ ] **Passo 3: Implementar `PracticeQuestionHeading`** para formatar banca ou nome da prova, acrescentar ano válido e omitir dados ausentes sem deixar separador solto.
- [ ] **Passo 4: Atualizar tipos e `mapPracticeQuestion`** para normalizar `imageUrls` do payload de nível superior e `provenance`; manter compatibilidade com `questionBankItem.imageUrls` em respostas antigas.
- [ ] **Passo 5: Usar o cabeçalho componentizado na página** e passar os dados da questão. Preservar renderização condicional de imagens e `OptimizedImage`.
- [ ] **Passo 6: Confirmar GREEN**:

  ```bash
  npm run test:unit -- tests/unit/PracticeQuestionHeading.test.tsx
  ```

  Esperado: casos do componente passam. Rodar também o contrato existente de imagens com `node --test tests/practice-question-images-contract.test.mjs`.

### Tarefa 5: Verificação integrada dos contratos

**Arquivos:** os arquivos e testes das Tarefas 1–4.

- [ ] **Passo 1: Rodar testes backend focados** de materialização, mapper e repositório; confirmar PASS.
- [ ] **Passo 2: Rodar o teste do componente e o contrato frontend de imagem**:

  ```bash
  npm run test:unit -- tests/unit/PracticeQuestionProvenance.test.tsx
  node --test tests/practice-question-images-contract.test.mjs
  ```

  Executar em `frontend/`; confirmar PASS.
- [ ] **Passo 3: Rodar typecheck dos dois pacotes**:

  ```bash
  npm run typecheck
  ```

  Executar uma vez em `backend/` e outra em `frontend/`; ambos devem terminar sem erros.

## Revisão de cobertura

- RF1/RF2 são cobertos pela caracterização de materialização na Tarefa 1.
- RF3 e prioridade/fallback são cobertos pelos testes unitários e de projeção das Tarefas 2 e 3.
- RF4 e renderização das imagens são cobertos pelo contrato frontend da Tarefa 4.
- RF5/RF6 e os cinco pontos de foco de revisão são exercitados nos testes de campos parciais, arrays vazios, ausência de origem e cópia idempotente.
- Não há migração, dependência nova ou alteração no fluxo de resposta.
