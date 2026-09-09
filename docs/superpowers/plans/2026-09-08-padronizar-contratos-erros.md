# Padronização de Contratos e Erros Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Padronizar erros HTTP, validações, logs seguros e tipagem dos principais payloads sem expor informações sensíveis.

**Architecture:** Criar camada central em src/core/errors e src/core/http, usada pelo error handler global e controllers migrados. A migração será incremental por risco: núcleo, auth/protected, billing/compras/webhooks, demais módulos e auditoria.

**Tech Stack:** TypeScript, Fastify 5, Zod 4, Prisma 7, Node test runner with node --import tsx --test.

**Spec:** docs/superpowers/specs/2026-09-08-padronizar-contratos-erros-design.md

## Global Constraints

- Respostas de erro migradas usam { error: { code, message, details } }.
- Não registrar objetos de erro completos, tokens, cookies, credenciais ou bodies integrais.
- Erros desconhecidos retornam INTERNAL_SERVER_ERROR sem detalhes internos.
- Preservar regras de negócio e códigos existentes durante a migração.
- Seguir TDD: RED antes do código, GREEN depois, refatorar somente com testes verdes.
- Preservar alterações não relacionadas no working tree.

---

### Task 1: Criar AppError e contrato público

**Files:**
- Create: src/core/errors/app-error.ts
- Create: src/core/errors/error-catalog.ts
- Create: src/core/http/error-response.ts
- Create: src/core/errors/__tests__/app-error.test.ts

- [ ] **Step 1: Escrever testes RED**

Cubra serialização sem internalDetails, preservação de statusCode, código obrigatório e conversão de erro desconhecido para resposta interna.

- [ ] **Step 2: Rodar RED**

    node --import tsx --test src/core/errors/__tests__/app-error.test.ts

- [ ] **Step 3: Implementar AppError, catálogo e serializer**

AppError aceita code, statusCode, publicMessage, internalDetails opcional e cause opcional. O serializer público nunca inclui cause ou detalhes internos.

- [ ] **Step 4: Rodar GREEN**

    node --import tsx --test src/core/errors/__tests__/app-error.test.ts

- [ ] **Step 5: Commit**

    git add src/core/errors src/core/http/error-response.ts
    git commit -m "feat: add typed application errors"

### Task 2: Error handler global e logging seguro

**Files:**
- Create: src/core/errors/safe-error-logger.ts
- Create: src/core/errors/error-handler.ts
- Create: src/core/errors/__tests__/error-handler.test.ts
- Modify: src/server.ts

- [ ] **Step 1: Escrever testes RED**

Cubra AppError, erro desconhecido, ZodError, requestId nos metadados e ausência de stack/token/body no log.

- [ ] **Step 2: Rodar RED**

    node --import tsx --test src/core/errors/__tests__/error-handler.test.ts

- [ ] **Step 3: Implementar logger e handler**

Aceite FastifyError/unknown, gere resposta padronizada e serialize somente método, URL, requestId, código e status. Não logue o objeto original.

- [ ] **Step 4: Rodar GREEN**

    node --import tsx --test src/core/errors/__tests__/error-handler.test.ts

- [ ] **Step 5: Conectar no server**

Substitua o setErrorHandler atual pelo handler central sem alterar o startup.

- [ ] **Step 6: Validar e commit**

    npm run typecheck
    npm run build
    git add src/core/errors src/server.ts
    git commit -m "feat: centralize safe HTTP error handling"

### Task 3: Migrar autenticação, rotas protegidas e módulos recentes

**Files:**
- Modify: src/middleware/auth.middleware.ts
- Modify: src/modules/student-profile/student-profile.routes.ts
- Modify: src/modules/student-access/student-access.routes.ts
- Modify: src/modules/student-flashcards/student-flashcards.routes.ts
- Modify: src/modules/chat/chat.routes.ts
- Create: src/core/http/request-schemas.ts
- Test: testes de erro dos módulos

- [ ] **Step 1: Escrever testes RED de contrato**

Cubra ausência de sessão (401), entrada inválida, acesso negado (403), recurso inexistente (404) e detalhes públicos sem dados internos.

- [ ] **Step 2: Rodar RED**

    node --import tsx --test src/modules/student-profile/__tests__/*.test.ts src/modules/student-access/__tests__/*.test.ts src/modules/student-flashcards/__tests__/*.test.ts

- [ ] **Step 3: Implementar AppError nos fluxos**

Substitua respostas manuais divergentes por erros tipados e schemas Zod estritos de entrada/saída onde já houver adapter modular.

- [ ] **Step 4: Rodar GREEN e typecheck**

    node --import tsx --test src/modules/student-profile/__tests__/*.test.ts src/modules/student-access/__tests__/*.test.ts src/modules/student-flashcards/__tests__/*.test.ts
    npm run typecheck

- [ ] **Step 5: Commit**

    git add src/middleware/auth.middleware.ts src/modules src/core/http
    git commit -m "refactor: standardize protected route errors"

### Task 4: Migrar billing, compras e webhooks

**Files:**
- Modify: src/controllers/student-purchase.controller.ts
- Modify: src/controllers/auth.controller.ts
- Modify: src/controllers/login.controller.ts
- Modify: src/modules/billing/controllers
- Modify: src/services/student-purchase.service.ts
- Modify: src/repositories/student-purchase.repository.ts
- Test: testes existentes de billing, auth e compras

- [ ] **Step 1: Escrever testes RED**

Cubra idempotency key ausente/reutilizada, compra inexistente, checkout inválido, webhook inválido, conflito de assinatura e falha de integração.

- [ ] **Step 2: Rodar RED**

    node --import tsx --test src/modules/billing/controllers/__tests__/*.test.ts

- [ ] **Step 3: Remover any de requests**

Use tipos Fastify para params, headers e body derivados de schemas Zod; dados externos entram como unknown e são validados antes do uso.

- [ ] **Step 4: Migrar erros para AppError**

Preserve códigos financeiros existentes e respostas públicas seguras.

- [ ] **Step 5: Rodar GREEN, typecheck e build**

    node --import tsx --test src/modules/billing/controllers/__tests__/checkout.controller.test.ts src/modules/billing/controllers/__tests__/subscription.controller.test.ts src/modules/billing/controllers/__tests__/webhook.controller.test.ts src/modules/billing/providers/__tests__/simulated-payment.provider.test.ts src/modules/billing/repositories/__tests__/billing.repository.test.ts src/modules/billing/services/__tests__/checkout.service.test.ts src/modules/billing/services/__tests__/simulated-confirmation.service.test.ts src/modules/billing/services/__tests__/subscription.service.test.ts src/modules/billing/services/__tests__/webhook.service.test.ts
    npm run typecheck
    npm run build

- [ ] **Step 6: Commit**

    git add src/controllers src/modules/billing src/services/student-purchase.service.ts src/repositories/student-purchase.repository.ts
    git commit -m "refactor: standardize billing and purchase errors"

### Task 5: Schemas principais e remoção de any

**Files:**
- Modify: payloads HTTP de auth, billing, compras, webhooks, questões e desafios
- Create: schemas Zod faltantes e testes correspondentes

- [ ] **Step 1: Gerar inventário atualizado**

    rg -n "\\bany\\b|as any|Record<string, any>" src --glob '*.ts'

- [ ] **Step 2: Escrever testes RED para schemas**

Cada schema deve rejeitar campos extras quando estrito, tipos incorretos e IDs inválidos; respostas devem validar campos obrigatórios.

- [ ] **Step 3: Implementar tipos derivados de Zod**

Substitua any de request/body/params por z.infer, tipos Fastify ou unknown validado. Não altere lógica de negócio.

- [ ] **Step 4: Rodar GREEN**

    node --import tsx --test src/core/http/__tests__/*.test.ts src/core/errors/__tests__/*.test.ts
    npm run typecheck

- [ ] **Step 5: Commit**

    git add src/core/http src/core/errors src/controllers src/modules src/services src/repositories
    git commit -m "refactor: type HTTP contracts with Zod"

### Task 6: Auditoria final

- [ ] **Step 1: Verificar logs inseguros**

    rg -n "console\\.(log|error).*\\b(error|err)\\b|console\\.(log|error).*authorization|console\\.(log|error).*cookie" src --glob '*.ts'

- [ ] **Step 2: Verificar any prioritário**

    rg -n "\\bany\\b|as any|Record<string, any>" src/controllers src/modules/billing src/services/student-purchase.service.ts src/repositories/student-purchase.repository.ts

- [ ] **Step 3: Rodar testes, typecheck e build**

    npm run test:chat
    npm run typecheck
    npm run build

- [ ] **Step 4: Revisar respostas fora do contrato**

Verifique controllers migrados e confirme que cada erro usa o envelope público, sem alterar respostas de sucesso.

- [ ] **Step 5: Documentar exceções preexistentes**

Registre qualquer any inevitável, falha não relacionada e endpoint ainda não migrado em documento de pendências.
