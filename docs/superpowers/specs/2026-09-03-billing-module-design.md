# Módulo de Billing e Assinaturas — Especificação

## Objetivo

Isolar o domínio de cobrança em `backend/src/modules/billing`, mantendo o backend como monólito nesta fase, com fronteiras que permitam extração futura para serviço independente.

O módulo deve suportar um cliente Stripe por aluno, uma assinatura recorrente agregada, vários monitores como subscription items, um enrollment por aluno/monitor, checkout simulado e webhooks idempotentes.

## Regras de negócio

1. O frontend nunca define preço, desconto, status de pagamento ou acesso.
2. Um aluno possui no máximo um Stripe Customer.
3. Um aluno possui no máximo uma assinatura recorrente ativa.
4. Uma assinatura pode conter vários monitores.
5. Um aluno não pode ter dois enrollments ativos para o mesmo monitor.
6. Toda criação de compra exige `Idempotency-Key`.
7. A mesma chave retorna o mesmo pedido quando pertence ao mesmo aluno.
8. Uma chave usada por outro aluno é rejeitada.
9. A compra nasce `PENDING` e só vira `PAID` após confirmação do provider.
10. O webhook é deduplicado por `provider_event_id`.
11. Confirmação, assinatura, itens e enrollments são efetivados na mesma transação.
12. Remover monitor agenda a remoção para o fim do período atual.
13. Cancelar todos os monitores agenda o cancelamento da assinatura agregada.
14. O acesso permanece ativo até `current_period_end` ou `ends_at`.
15. Alterações geram histórico novo; compras pagas não são sobrescritas.

## Fronteira do módulo

```text
src/modules/billing/
├── billing.module.ts
├── billing.routes.ts
├── controllers/       # HTTP e códigos de resposta
├── services/          # regras de checkout, assinatura e webhook
├── repositories/      # Prisma/PostgreSQL
├── models/            # Zod e tipos do domínio
├── providers/         # porta de pagamento e adapter simulado/Stripe
└── errors/
```

Fora do módulo, nenhum controller pode importar provider, repository ou Prisma de billing. A aplicação principal apenas registra o módulo e injeta configuração.

## Relações

```text
students 1 ─── 1 stripe_customers
students 1 ─── N student_purchases 1 ─── N student_purchase_items
students 1 ─── 1 billing_subscriptions 1 ─── N billing_subscription_items
students 1 ─── N student_enrollments
```

### `stripe_customers`

`id`, `student_id UNIQUE`, `provider`, `provider_customer_id UNIQUE`, timestamps.

### `billing_subscriptions`

`id`, `student_id`, `stripe_customer_id`, `provider_subscription_id UNIQUE`, `status`, `billing_interval`, `currency`, `subtotal_amount`, `discount_amount`, `total_amount`, períodos, `cancel_at_period_end`, timestamps.

Deve existir no máximo uma assinatura ativa por aluno.

### `billing_subscription_items`

`id`, `billing_subscription_id`, `monitor_id`, `provider_subscription_item_id UNIQUE`, `status`, valores antes/depois do desconto, `current_period_end`, `removed_at`, timestamps.

Há unicidade por `(billing_subscription_id, monitor_id)`.

### `student_enrollments`

`id`, `student_id`, `monitor_id`, `subscription_item_id`, `status`, `starts_at`, `ends_at`, timestamps.

Há unicidade por `(student_id, monitor_id)`. O enrollment representa acesso, não cobrança.

### Histórico e webhooks

`student_purchases` e `student_purchase_items` são históricos imutáveis de checkout e alteração de plano.

`billing_webhook_events` contém `provider`, `provider_event_id UNIQUE`, `event_type`, `payload`, `status`, `processed_at`, `failure_message` e timestamps.

`student_payment_sessions` armazena somente hash do token, valor, moeda, validade e vínculos. O token cru nunca é persistido nem logado.

## Provider

```ts
interface PaymentProvider {
  getOrCreateCustomer(input: { studentId: string; email: string }): Promise<{ customerId: string }>;
  createCheckout(input: { customerId: string; purchaseId: string; amount: number; currency: string; interval: 'MONTH' | 'YEAR' }): Promise<{ checkoutId: string; checkoutUrl: string; expiresAt: Date }>;
  updateSubscription(input: { subscriptionId: string; amount: number; interval: 'MONTH' | 'YEAR'; effectiveAt: 'NOW' | 'PERIOD_END' }): Promise<void>;
  cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
}
```

O provider simulado implementa o mesmo contrato sem rede externa. O adapter Stripe real poderá substituí-lo sem alterar os services.

## Fluxos

Compra: autenticar aluno → validar monitores → calcular total no backend → criar customer → criar compra `PENDING` e itens → criar checkout → salvar referência/link → retornar checkout.

Webhook: registrar `provider_event_id` → ignorar evento processado → validar assinatura/valor → transação com `PAID`, assinatura, items e enrollments → marcar evento `PROCESSED`.

Remoção: item e enrollment ficam `PENDING_REMOVAL`, provider é atualizado com `PERIOD_END` e o acesso só vira `REMOVED` no fim do período.

## Critérios de aceite

- Dois cliques com a mesma chave não criam duas compras.
- Um aluno possui um customer e uma assinatura ativa.
- Dois monitores entram na mesma assinatura e geram dois enrollments.
- Repetir o mesmo webhook não duplica efeitos.
- Remoção não revoga acesso antes do fim do período.
- Mensal/anual e alteração de monitores preservam histórico.
