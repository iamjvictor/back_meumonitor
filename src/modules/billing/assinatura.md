# Fluxo de assinatura

Documentação do checkout simulado e da confirmação da assinatura.

## Teste analisado

Usuário autenticado: `7e3cb032-148a-42f5-af66-b3c652000104`.
Aluno: `39a2b276-0623-4cbb-9031-260676383722`.
Compra: `b9a2483a-ed61-43c7-9177-e255bb02a88c`.
Monitor: 1.
Intervalo: `MONTH`.
Valor: `1990` centavos, ou R$ 19,90.
Status inicial: `PENDING`.

Até a confirmação, nenhuma assinatura deve estar ativa.

## 1. Requisição HTTP

O frontend dispara `POST /api/v1/student/purchases`, com a sessão do aluno,
`Content-Type: application/json` e `Idempotency-Key`.

O corpo contém apenas `monitorIds` e `paymentMethod`. Preço, desconto, status e
acesso são definidos pelo backend.

Evento inicial:

```text
monitor.student_purchase_http_create_started
```

## 2. Autenticação e validação

O middleware valida os cookies e resolve o usuário. Depois o billing verifica a
chave de idempotência, o aluno, o monitor publicado e assinaturas ativas.

Eventos:

```text
monitor.billing_checkout_requested
monitor.billing_checkout_started
monitor.student_purchase_db_idempotency_lookup_completed
monitor.student_purchase_db_monitors_lookup_completed
monitor.student_purchase_db_active_subscriptions_lookup_completed
monitor.billing_checkout_validated
```

No teste, a chave não existia anteriormente, o monitor foi encontrado e não
havia assinatura ativa.

## 3. Cálculo do valor

O backend calculou `unitAmount=1990`, `itemCount=1`, `discountAmount=0`,
`totalAmount=1990` e `currency=BRL`.

Evento:

```text
monitor.billing_checkout_amount_calculated
```

Os valores são inteiros em centavos e não vêm do navegador.

## 4. Compra persistida

Foi criado um registro em `student_purchases` com o ID informado, o aluno,
`status=PENDING`, `total_amount=1990` e `currency=BRL`.

Também foi criado um item em `student_purchase_items`, com o monitor e o
snapshot do nome/preço usado na intenção. Esse snapshot preserva o histórico se
o preço padrão mudar no futuro.

Eventos:

```text
monitor.billing_purchase_creation_started
monitor.student_purchase_db_create_started
monitor.student_purchase_db_create_completed
monitor.billing_purchase_created
```

## 5. Cliente do pagamento

O provider simulado resolveu ou criou um cliente determinístico para o aluno e
persistiu a relação em `stripe_customers`. A unicidade é por aluno. Neste trecho
de log, `billing_customer_resolved` confirma a resolução, mas não distingue se
foi uma criação nova ou reutilização.

```text
monitor.billing_customer_resolved
provider=SIMULATED
customerResolved=true
```

Nenhuma chamada real à Stripe ocorreu.

## 6. Checkout e URL

O backend solicitou a URL ao provider simulado e recebeu:

- `checkoutId`: `sim_checkout_34c1001f999a80b2b7e92d5c`;
- `checkoutUrl`: `/checkout/simulado`;
- expiração: `2026-09-03T21:36:49.788Z`;
- status da compra: `PENDING`.

Eventos:

```text
monitor.billing_checkout_url_requested
monitor.billing_checkout_url_created
```

## 7. Sessão temporária

Foi criada uma linha em `student_payment_sessions`:

- ID: `bdf9832e-0b3a-4cf0-bc56-027bcb7ec003`;
- compra: `b9a2483a-ed61-43c7-9177-e255bb02a88c`;
- expiração: `2026-09-03T21:36:49.788Z`.

O token original não é salvo, apenas seu hash.

Depois, `student_purchases.gateway_checkout_id` recebeu a referência:
`simulated:sim_checkout_34c1001f999a80b2b7e92d5c`.

Eventos:

```text
monitor.student_purchase_db_payment_session_create_started
monitor.student_purchase_db_payment_session_create_completed
monitor.student_purchase_db_checkout_reference_saved
```

## 8. Resposta da criação

O backend respondeu com `purchaseId`, `status`, `checkoutUrl`, `sessionId`,
`expiresAt`, `amount` e `currency`. O frontend então abriu
`/checkout/simulado`.

Eventos finais:

```text
monitor.billing_checkout_completed
monitor.student_purchase_http_create_completed
```

## 9. Múltiplos GET de sessão

`req-t` e `req-u` foram dois `GET /api/v1/session` feitos ao abrir a tela.
Ambos confirmaram `studentFound=true` e `resolvedRole=student`.

São leituras, não compras. Não criam checkout, assinatura ou cobrança. Podem
ocorrer em paralelo pelo guard de sessão e pelo contexto da área do aluno.

## 10. Próxima etapa: confirmação

Ao confirmar, o backend valida e consome a sessão uma única vez, processa o
webhook simulado e deve:

1. marcar `student_purchases` como `PAID`;
2. criar `billing_subscriptions`;
3. criar `billing_subscription_items`;
4. criar `student_enrollments`;
5. atualizar a projeção compatível em `student_subscriptions`;
6. retornar `PAID` ao frontend.

Somente depois disso o frontend redireciona para `/areadoaluno`.

## 12. Confirmação observada no teste

Na primeira confirmação da compra `b9a2483a-ed61-43c7-9177-e255bb02a88c`, o
backend processou o webhook simulado e concluiu a aprovação. A sessão utilizada
foi `f9b43cfe-3e37-47f3-9424-fdc799b5506a`.

O fluxo registrado foi:

```text
monitor.student_purchase_http_simulated_webhook_started
monitor.billing_simulated_confirmation_started
monitor.student_purchase_db_student_lookup_completed
monitor.student_purchase_db_payment_session_lookup_completed
monitor.student_purchase_db_payment_session_consume_completed
monitor.billing_simulated_confirmation_session_consumed
monitor.billing_webhook_received
monitor.billing_webhook_claimed
monitor.billing_webhook_validated
monitor.billing_purchase_approval_started
monitor.billing_purchase_approval_transaction_started
monitor.billing_customer_verified_for_webhook
monitor.billing_subscription_persisted
monitor.billing_legacy_subscription_projection_updated
monitor.billing_subscription_items_and_enrollments_persisted
monitor.billing_purchase_status_updated
monitor.billing_purchase_approved
monitor.billing_subscription_created
monitor.billing_subscription_items_created
monitor.billing_enrollments_created
monitor.billing_webhook_processed
monitor.billing_simulated_confirmation_completed
monitor.student_purchase_http_simulated_webhook_completed
```

Resultado observado:

- compra: `PENDING` → `PAID`;
- assinatura billing criada: `9d0a06e2-3578-4188-b5f0-5204df5c5095`;
- assinatura do provider: `simulated:b9a2483a-ed61-43c7-9177-e255bb02a88c`;
- 1 item de assinatura criado;
- 1 enrollment criado;
- projeção legada atualizada;
- resposta HTTP final: `status=PAID`.

## 13. Tabelas alteradas na confirmação

### `student_payment_sessions`

Registro da sessão temporária usada para autorizar a confirmação.

Na confirmação:

- a sessão é localizada pelo hash do token;
- o aluno e a compra são conferidos;
- `consumed_at` é preenchido;
- uma sessão consumida não pode ser consumida novamente.

Essa tabela não representa pagamento. Ela representa somente a autorização
temporária da simulação.

### `billing_webhook_events`

Registro idempotente do webhook recebido.

Na primeira confirmação:

- é criado um evento com `provider=SIMULATED`;
- `provider_event_id` usa o formato `simulated:<session-record-id>`;
- o evento inicia em `CLAIMED`;
- depois dos efeitos, passa para `PROCESSED`.

Se algum efeito falhar, o evento passa para `FAILED` e pode ser reprocessado.
A unicidade é composta por `provider` e `provider_event_id`.

### `student_purchases`

É o registro financeiro da intenção de compra.

Na criação do checkout:

- `status=PENDING`;
- `total_amount` e `currency` são definidos pelo backend;
- `gateway_checkout_id` recebe a referência do checkout simulado.

Na aprovação:

- `status` muda para `PAID`;
- `paid_at` recebe o horário da aprovação;
- `gateway` recebe `SIMULATED`;
- `gateway_payment_id` recebe o identificador do evento.

Uma compra paga não deve ser sobrescrita por uma nova compra. Novas alterações
de assinatura geram histórico próprio.

### `student_purchase_items`

Itens da compra original. Cada item relaciona a compra a um monitor e mantém:

- `monitor_id`;
- `description_snapshot`;
- `unit_amount`;
- `quantity`.

Esses valores são históricos e não devem ser recalculados quando o preço padrão
do monitor mudar.

### `stripe_customers`

Representa o cliente no provider de pagamento.

- existe no máximo um cliente por aluno;
- no provider simulado, o identificador é determinístico;
- o registro é reutilizado em novas compras do mesmo aluno;
- nenhum token ou dado sensível é armazenado nos logs.

### `billing_subscriptions`

É o agregado principal da assinatura recorrente.

Na confirmação é criada uma assinatura para o aluno, com:

- `customer_id` apontando para `stripe_customers`;
- `provider_subscription_id` do provider;
- `status=ACTIVE`;
- `billing_interval=MONTH`;
- `subtotal_amount`, `discount_amount` e `total_amount`;
- início e fim do período atual.

O aluno pode ter vários monitores nessa mesma assinatura agregada. A regra é
manter no máximo uma assinatura ativa por aluno.

### `billing_subscription_items`

Cada linha representa um monitor dentro da assinatura agregada.

Na confirmação:

- é criado um item por monitor da compra;
- `subscription_id` aponta para `billing_subscriptions`;
- `monitor_id` identifica o monitor;
- `status=ACTIVE`;
- os valores do item são gravados em centavos;
- `current_period_end` recebe o fim do período.

A unicidade é `(subscription_id, monitor_id)`. Adicionar o mesmo monitor depois
reativa o item pendente em vez de criar uma segunda linha.

### `student_enrollments`

Controla o acesso do aluno a cada monitor.

Na confirmação:

- é criado um enrollment por aluno/monitor;
- `subscription_item_id` aponta para o item billing correspondente;
- `status=ACTIVE`;
- `starts_at` recebe o horário da ativação;
- `ends_at` permanece nulo enquanto o acesso estiver ativo.

A unicidade é `(student_id, monitor_id)`. Na remoção de um monitor, o enrollment
fica `PENDING_REMOVAL` até o fim do período, sem revogação imediata.

### `billing_subscription_changes`

Histórico append-only das alterações posteriores da assinatura.

Registra operações como:

- `ADD`;
- `REACTIVATE`;
- `REMOVE`;
- `INTERVAL_CHANGE`;
- `CANCEL`.

Cada alteração possui `operation_key` único. Esse campo permite replay
idempotente sem duplicar efeitos, e `metadata` guarda o resultado operacional
necessário para responder novamente à mesma requisição.

## 14. Confirmação repetida e idempotência

Depois que a compra já está `PAID`, uma nova confirmação da mesma intenção:

1. valida a sessão e o aluno;
2. identifica a compra já paga;
3. retorna `status=PAID`;
4. não consome novamente a sessão;
5. não cria outro webhook efetivo;
6. não cria outra assinatura, item ou enrollment.

Foi exatamente o que ocorreu nos requests seguintes: apareceram apenas os logs
de início, busca da sessão e resposta HTTP `PAID`. A ausência dos logs de criação
da assinatura indica que o replay foi encerrado de forma idempotente.

## 15. Compatibilidade com o fluxo antigo

`student_subscriptions` continua existindo porque telas e consultas antigas
dependem dela. Durante a migração:

- `billing_subscriptions` é a fonte do agregado de cobrança;
- `billing_subscription_items` representa os monitores da assinatura;
- `student_enrollments` representa o acesso billing;
- `student_subscriptions` recebe uma projeção compatível por monitor.

Ao remover essa compatibilidade no futuro, todos os leitores de
`student_subscriptions` deverão ser migrados para `student_enrollments` antes de
retirar a projeção.
