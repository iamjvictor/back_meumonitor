# Modularização das Rotas Legadas Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extrair perfil, acesso, flashcards e consultas de questões das rotas legadas, preservando contratos HTTP e removendo Prisma/regra de negócio dos adapters.

**Architecture:** Migração incremental strangler. Cada módulo terá composition root, routes/controller, serviço de aplicação e repositórios Prisma. O módulo de acesso fornecerá autorização reutilizável.

**Tech Stack:** TypeScript, Fastify, Prisma, Node test runner with `node --import tsx --test`, Zod when already adopted and `app.inject()` when an isolated app factory exists.

**Spec:** docs/superpowers/specs/2026-09-08-modularizar-rotas-legadas-design.md

## Global Constraints

- Preservar URLs, métodos, status HTTP e códigos de erro existentes.
- Não implementar SSE, retry do chat ou trocar o armazenamento Redis.
- Rotas migradas não podem importar Prisma nem conter regra de negócio.
- Seguir TDD: teste falhando antes da implementação, depois verde e refatoração.
- Preservar alterações não relacionadas existentes no working tree.
- Não reescrever desafio diário, performance ou tentativas.

---

### Task 1: Capturar contratos e inventariar rotas

**Files:**
- Create: src/modules/student-profile/__tests__/student-profile.contract.test.ts
- Create: src/modules/student-access/__tests__/student-access.contract.test.ts
- Create: src/modules/student-flashcards/__tests__/student-flashcards.contract.test.ts

- [ ] **Step 1: Localizar bootstrap e convenções de testes**

Run:

    rg -n "app\\.inject|protectedRoutes|student/profile|flashcards/random|monitors/.*/cancel" src test tests

Reuse o app factory, fixtures de autenticação e helpers existentes.

- [ ] **Step 2: Escrever testes de contrato**

Capture perfil válido, rating inválido, monitor sem acesso (403), flashcard inexistente (404) e cancelamento bem-sucedido. Assert status e campos estáveis, não chamadas internas do Prisma.

- [ ] **Step 3: Executar baseline**

    node --import tsx --test src/modules/student-profile/__tests__/student-profile.contract.test.ts src/modules/student-access/__tests__/student-access.contract.test.ts src/modules/student-flashcards/__tests__/student-flashcards.contract.test.ts

Registre falhas preexistentes antes da extração.

- [ ] **Step 4: Inventariar endpoints**

    rg -n "app\\.(get|post|put|patch|delete)\\(" src/routes/protected.routes.ts

Se não existir consulta de questão nesse arquivo, não criar endpoint artificial.

- [ ] **Step 5: Commit**

    git add src/modules/student-profile/__tests__ src/modules/student-access/__tests__ src/modules/student-flashcards/__tests__
    git commit -m "test: capture legacy student route contracts"

### Task 2: Extrair perfil do aluno

**Files:**
- Create: src/modules/student-profile/student-profile.module.ts
- Create: src/modules/student-profile/student-profile.routes.ts
- Create: src/modules/student-profile/student-profile.controller.ts
- Create: src/modules/student-profile/student-profile.service.ts
- Create: src/modules/student-profile/student-profile.repository.ts
- Create: src/modules/student-profile/__tests__/student-profile.service.test.ts
- Modify: src/server.ts
- Modify: src/routes/protected.routes.ts

- [ ] **Step 1: Escrever teste RED do serviço**

Chame o serviço com identidade autenticada e payload válido; verifique perfil retornado e entrada tipada enviada ao repositório.

- [ ] **Step 2: Confirmar falha**

    node --import tsx --test src/modules/student-profile/__tests__/student-profile.service.test.ts

Esperado: falha porque o novo serviço não existe.

- [ ] **Step 3: Implementar mínimo**

Defina ports tipados, encapsule StudentRepository e preserve defaults/criação idempotente atuais.

- [ ] **Step 4: Confirmar GREEN**

    node --import tsx --test src/modules/student-profile/__tests__/student-profile.service.test.ts

- [ ] **Step 5: Adicionar adapter e composition root**

Deixe no adapter somente parsing, validação, chamada e mapeamento HTTP. Registre no server.ts com prefixo /api/v1 e autenticação atuais.

- [ ] **Step 6: Remover rota antiga e validar**

    node --import tsx --test src/modules/student-profile/__tests__

- [ ] **Step 7: Commit**

    git add src/modules/student-profile src/server.ts src/routes/protected.routes.ts
    git commit -m "refactor: extract student profile module"

### Task 3: Extrair acesso e cancelamento de monitores

**Files:**
- Create: src/modules/student-access/student-access.module.ts
- Create: src/modules/student-access/student-access.routes.ts
- Create: src/modules/student-access/student-access.controller.ts
- Create: src/modules/student-access/student-access.service.ts
- Create: src/modules/student-access/student-access.repository.ts
- Create: src/modules/student-access/__tests__/student-access.service.test.ts
- Modify: src/server.ts
- Modify: src/routes/protected.routes.ts

- [ ] **Step 1: Escrever testes RED**

Cubra assinatura ativa, matrícula ativa, professor proprietário, ausência (403), criação do aluno e cancelamento de assinatura/matrícula.

- [ ] **Step 2: Confirmar RED**

    node --import tsx --test src/modules/student-access/__tests__/student-access.service.test.ts

- [ ] **Step 3: Implementar serviço/repositório**

Centralize a decisão em StudentAccessService.assertMonitorAccess(input) e cancelMonitorAccess(input). O serviço não deve retornar reply.

- [ ] **Step 4: Confirmar GREEN**

    node --import tsx --test src/modules/student-access/__tests__/student-access.service.test.ts

- [ ] **Step 5: Registrar adapter e remover cancelamento legado**

Preserve POST /student/monitors/:monitorId/cancel, payload e status atuais; garanta uma única rota.

- [ ] **Step 6: Validar e commit**

    node --import tsx --test src/modules/student-access/__tests__
    git add src/modules/student-access src/server.ts src/routes/protected.routes.ts
    git commit -m "refactor: extract student monitor access module"

### Task 4: Extrair flashcards e revisão SRS

**Files:**
- Create: src/modules/student-flashcards/student-flashcards.module.ts
- Create: src/modules/student-flashcards/student-flashcards.routes.ts
- Create: src/modules/student-flashcards/student-flashcards.controller.ts
- Create: src/modules/student-flashcards/student-flashcards.service.ts
- Create: src/modules/student-flashcards/student-flashcards.repository.ts
- Create: src/modules/student-flashcards/__tests__/student-flashcards.service.test.ts
- Modify: src/server.ts
- Modify: src/routes/protected.routes.ts

- [ ] **Step 1: Escrever teste RED de seleção**

Cubra seleção autorizada, ausência de flashcard e isolamento por monitor/aluno.

- [ ] **Step 2: Confirmar RED**

    node --import tsx --test src/modules/student-flashcards/__tests__/student-flashcards.service.test.ts --test-name-pattern random

- [ ] **Step 3: Implementar seleção mínima**

Use StudentAccessService.assertMonitorAccess, pickRandomAvailable e repositório, sem Prisma no adapter.

- [ ] **Step 4: Escrever teste RED de revisão**

Cubra rating inválido no adapter, revisão autorizada, atualização de progresso e criação do log com estado SRS calculado.

- [ ] **Step 5: Confirmar RED e implementar**

    node --import tsx --test src/modules/student-flashcards/__tests__/student-flashcards.service.test.ts --test-name-pattern review

Mova a orquestração para o serviço/repositório sem alterar semântica SRS ou resposta.

- [ ] **Step 6: Confirmar GREEN e remover legado**

    node --import tsx --test src/modules/student-flashcards/__tests__

Remova imports de Prisma, seleção e SRS de protected.routes.ts quando não forem mais usados.

- [ ] **Step 7: Commit**

    git add src/modules/student-flashcards src/server.ts src/routes/protected.routes.ts
    git commit -m "refactor: extract student flashcards module"

### Task 5: Mapear questões e finalizar limpeza

**Files:**
- Create: src/modules/student-questions/* somente se houver consulta legada real
- Modify: src/routes/protected.routes.ts
- Modify: src/server.ts somente se necessário

- [ ] **Step 1: Criar teste de ownership**

Cada consulta encontrada no inventário deve ter módulo proprietário; tentativas continuam no módulo existente.

- [ ] **Step 2: Confirmar RED quando houver rota sem owner**

    node --import tsx --test src/modules/student-questions/__tests__

- [ ] **Step 3: Implementar somente a fronteira necessária**

Preserve o contrato e mova Prisma para repositório. Sem consulta legada, documente a ausência e não crie código artificial.

- [ ] **Step 4: Remover código morto e validar**

    node --import tsx --test src/modules/student-profile src/modules/student-access src/modules/student-flashcards src/modules/student-questions

- [ ] **Step 5: Commit**

    git add src/modules/student-questions src/routes/protected.routes.ts src/server.ts
    git commit -m "refactor: finalize legacy student route cleanup"

### Task 6: Verificação final

- [ ] **Step 1: Verificar ausência de Prisma nos adapters**

    rg -n "from ['\\\"](@prisma/client|.*prisma)" src/modules/student-profile src/modules/student-access src/modules/student-flashcards src/modules/student-questions --glob '*routes.ts' --glob '*controller.ts' || true

Esperado: nenhuma saída.

- [ ] **Step 2: Executar testes afetados**

    node --import tsx --test src/modules/student-profile src/modules/student-access src/modules/student-flashcards src/modules/student-questions

- [ ] **Step 3: Executar typecheck e build**

    npm run typecheck
    npm run build

Documente separadamente falhas preexistentes do desafio diário.

- [ ] **Step 4: Revisar duplicidade e diff**

    git diff --check
    rg -n "student/(profile|flashcards|monitors)" src/routes src/modules src/server.ts
    git status --short

Confirme uma única implementação por endpoint e ausência de alterações não relacionadas.
