# Billing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover compras e assinaturas para um módulo billing isolado, preparado para Stripe Customer único, assinatura agregada, múltiplos monitores, enrollments e webhooks idempotentes.

**Architecture:** Billing será um bounded context dentro do backend. Controllers, services, repositories, models e providers ficarão em `src/modules/billing`; a aplicação principal apenas registra rotas e configuração. O provider simulado implementará a mesma porta do futuro provider Stripe.

**Tech Stack:** TypeScript, Fastify, Prisma, PostgreSQL/Supabase, Zod, Node Test Runner e `tsx`.

**Spec:** `backend/docs/superpowers/specs/2026-09-03-billing-module-design.md`

## Global Constraints

- Frontend não define preço, desconto, pagamento ou acesso.
- Compra nasce `PENDING` e somente webhook válido produz `PAID`.
- Um aluno tem no máximo um customer e uma assinatura ativa.
- Webhook repetido não duplica efeitos.
- Remoção ocorre somente no fim do período.
- Provider simulado não usa rede externa.
- Tokens não são persistidos em claro nem logados.

---

### Task 1: Contratos e modelos

**Files:**
- Create: `backend/src/modules/billing/models/checkout.model.ts`
- Create: `backend/src/modules/billing/models/subscription.model.ts`
- Create: `backend/src/modules/billing/models/webhook.model.ts`
- Create: `backend/src/modules/billing/providers/payment-provider.port.ts`
- Create: `backend/src/modules/billing/errors/billing.errors.ts`
- Test: `backend/src/modules/billing/models/__tests__/billing.model.test.ts`

- [ ] Escrever testes falhos para monitor vazio, intervalo inválido, valor negativo e webhook sem `providerEventId`.
- [ ] Confirmar falha com `node --import tsx --test src/modules/billing/models/__tests__/billing.model.test.ts`.
- [ ] Implementar schemas Zod estritos e tipos inferidos.
- [ ] Rodar novamente e confirmar aprovação.

### Task 2: Schema e repositories

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_billing_module/migration.sql`
- Create: `backend/src/modules/billing/repositories/customer.repository.ts`
- Create: `backend/src/modules/billing/repositories/purchase.repository.ts`
- Create: `backend/src/modules/billing/repositories/subscription.repository.ts`
- Create: `backend/src/modules/billing/repositories/enrollment.repository.ts`
- Create: `backend/src/modules/billing/repositories/webhook-event.repository.ts`
- Test: `backend/src/modules/billing/repositories/__tests__/billing.repository.test.ts`

- [ ] Escrever testes falhos para customer único, assinatura ativa única, item por monitor, enrollment por aluno/monitor e webhook único.
- [ ] Confirmar falha antes da implementação.
- [ ] Criar `stripe_customers`, `billing_subscriptions`, `billing_subscription_items`, `student_enrollments` e `billing_webhook_events` com foreign keys, índices e constraints.
- [ ] Implementar repositories sem expor Prisma para fora do módulo.
- [ ] Aplicar com `npx prisma migrate deploy` e rodar os testes.

### Task 3: Provider simulado

**Files:**
- Create: `backend/src/modules/billing/providers/simulated-payment.provider.ts`
- Test: `backend/src/modules/billing/providers/__tests__/simulated-payment.provider.test.ts`

- [ ] Escrever teste falho para customer determinístico, checkout com valor backend e URL simulada.
- [ ] Implementar `PaymentProvider` sem rede externa.
- [ ] Testar atualização com `effectiveAt: 'PERIOD_END'` e cancelamento no fim do período.
- [ ] Confirmar todos os testes verdes.

### Task 4: Checkout agregado e idempotência

**Files:**
- Create: `backend/src/modules/billing/services/checkout.service.ts`
- Modify: `backend/src/modules/billing/repositories/purchase.repository.ts`
- Test: `backend/src/modules/billing/services/__tests__/checkout.service.test.ts`

- [ ] Testar compra com dois monitores, uma chave e um total agregado.
- [ ] Testar duas chamadas iguais retornando o mesmo `purchaseId`.
- [ ] Testar chave usada por outro aluno com `IDEMPOTENCY_KEY_REUSED`.
- [ ] Implementar cálculo no backend, customer, purchase `PENDING`, itens, checkout e payment session.
- [ ] Persistir `provider_checkout_id` e retornar `checkoutUrl`.

### Task 5: Webhook idempotente

**Files:**
- Create: `backend/src/modules/billing/services/webhook.service.ts`
- Create: `backend/src/modules/billing/controllers/webhook.controller.ts`
- Test: `backend/src/modules/billing/services/__tests__/webhook.service.test.ts`

- [ ] Escrever teste falho processando duas vezes o mesmo `providerEventId`.
- [ ] Escrever teste falho para valor divergente e assinatura inválida.
- [ ] Implementar claim do evento e transação de `PAID`, billing subscription, items e enrollments.
- [ ] Marcar `PROCESSED` somente depois dos efeitos e `FAILED` em erro reprocessável.
- [ ] Confirmar que reexecução não duplica registros.

### Task 6: Alterações e remoção no período

**Files:**
- Create: `backend/src/modules/billing/services/subscription.service.ts`
- Test: `backend/src/modules/billing/services/__tests__/subscription.service.test.ts`

- [ ] Testar adição de monitor na mesma assinatura agregada.
- [ ] Testar remoção como `PENDING_REMOVAL` sem revogar acesso imediato.
- [ ] Testar remoção do último monitor agendando cancelamento da assinatura.
- [ ] Testar mudança de `MONTH` para `YEAR` preservando histórico.
- [ ] Implementar atualização do provider e dos enrollments.

### Task 7: Rotas e composição

**Files:**
- Create: `backend/src/modules/billing/billing.routes.ts`
- Modify: `backend/src/modules/billing/billing.module.ts`
- Modify: `backend/src/routes/student-purchase.routes.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/src/modules/billing/controllers/__tests__/billing.controller.test.ts`

- [ ] Testar autenticação, `Idempotency-Key` ausente, erro de ownership e webhook repetido.
- [ ] Compor todas as dependências apenas em `billing.module.ts`.
- [ ] Registrar as rotas pelo módulo e preservar compatibilidade dos endpoints atuais.
- [ ] Garantir que módulos externos não importem Prisma ou provider de billing.

### Task 8: Frontend e migração final

**Files:**
- Modify: `frontend/src/app/(public-teacher)/p/[teacherSlug]/StorefrontClient.tsx`
- Modify: `frontend/src/app/(student-app)/checkout/simulado/page.tsx`
- Delete: implementações antigas somente após remoção de todos os imports

- [ ] Enviar chave estável por intenção de compra.
- [ ] Consumir apenas valor e `checkoutUrl` retornados pelo backend.
- [ ] Manter a página simulada com apenas a ação de confirmação.
- [ ] Redirecionar para `/areadoaluno` somente após `PAID`.
- [ ] Rodar typecheck frontend/backend, testes focados e fluxo manual com dois monitores.
- [ ] Usar `rg` para provar que nenhum módulo fora de billing importa implementações antigas.
