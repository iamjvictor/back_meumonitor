# Compras e Assinaturas de Monitores por Alunos

## Objetivo

Modelar o fluxo de compra de monitores por alunos, registrando o pedido
financeiro, os itens adquiridos, o estado do pagamento e o acesso liberado ao
monitor. O fluxo deve ser idempotente, auditável e seguro para receber
confirmações repetidas de um gateway de pagamento.

## Premissas desta versão

- O produto inicial é uma assinatura mensal recorrente.
- Um pedido pode conter um ou mais monitores.
- O aluno pode comprar novamente um monitor somente depois que a assinatura
  anterior estiver encerrada, ou quando o gateway indicar uma nova contratação
  legítima.
- `student_subscriptions` representa o acesso atual do aluno; não é o
  histórico financeiro.
- O checkout atual é apenas uma interface demonstrativa. A confirmação real
  deverá ocorrer no backend por webhook do gateway.
- O gateway de pagamento ainda não foi escolhido; a integração deve ser
  encapsulada por um adaptador.

## Decisões de modelagem

### 1. Pedido separado do acesso

O sistema terá três responsabilidades distintas:

```text
student_purchases
    histórico de pedidos e pagamentos

student_purchase_items
    monitores e preços congelados no momento da compra

student_subscriptions
    acesso vigente do aluno ao monitor
```

O pagamento aprovado cria ou ativa uma assinatura. Cancelamento, expiração ou
falha de cobrança alteram a assinatura, mas nunca apagam o pedido histórico.

### 2. Preço congelado no pedido

O item da compra deve armazenar o preço, moeda e descrição do monitor no
momento da contratação. Alterações futuras no preço do monitor não modificam
pedidos antigos nem o valor usado para auditoria.

### 3. Estado financeiro controlado pelo backend

O frontend não pode liberar acesso apenas porque o usuário clicou em
“confirmar compra”. O acesso somente é liberado depois que o backend validar a
confirmação do gateway ou, no ambiente de desenvolvimento, uma confirmação
explicitamente marcada como simulada.

## Modelo de dados proposto

### `student_purchases`

Representa uma tentativa ou contratação financeira.

Campos mínimos:

```text
id                         UUID PK
student_id                 UUID FK students
status                     PENDING | PROCESSING | PAID | FAILED | CANCELLED | REFUNDED | EXPIRED
payment_method             PIX | CREDIT_CARD | BOLETO | OTHER
currency                   BRL
subtotal_amount            valor inteiro em centavos
discount_amount            valor inteiro em centavos
total_amount               valor inteiro em centavos
gateway                    nome do provedor
gateway_checkout_id        identificador externo do checkout
gateway_payment_id         identificador externo do pagamento
idempotency_key            chave única da criação do pedido
failure_code               código técnico opcional
failure_message            mensagem segura para auditoria
paid_at                    timestamp opcional
cancelled_at               timestamp opcional
refunded_at                timestamp opcional
created_at                 timestamp
updated_at                 timestamp
```

Restrições:

- `idempotency_key` deve ser única por tentativa lógica de checkout.
- `gateway_payment_id` deve ser único quando informado, permitindo webhook
  repetido sem duplicar pagamento.
- Valores monetários devem ser inteiros em centavos; não usar `Float`.
- `student_id` deve apontar para o aluno autenticado que iniciou o checkout.

### `student_purchase_items`

Representa cada monitor do pedido.

Campos mínimos:

```text
id                         UUID PK
purchase_id                UUID FK student_purchases
monitor_id                 UUID FK monitors
description_snapshot       nome do monitor no momento da compra
unit_amount                preço mensal em centavos
quantity                   1
subscription_months        1 ou NULL para recorrência contínua
created_at                 timestamp
```

Restrições:

- `quantity` deve ser 1 no MVP.
- Uma mesma compra não pode conter o mesmo monitor duas vezes.
- O monitor deve estar `PUBLISHED` no momento da criação do pedido.
- O preço deve ser obtido no backend, nunca confiado ao valor enviado pelo
  navegador.

### Ajustes em `student_subscriptions`

A tabela existente será mantida como projeção de acesso, com estes campos
adicionais:

```text
purchase_id                UUID FK student_purchases, nullable no legado
gateway_subscription_id    identificador externo da recorrência
current_period_start       timestamp
current_period_end         timestamp
cancel_at_period_end       boolean default false
cancelled_at               timestamp opcional
last_payment_id             UUID FK student_purchases, nullable
```

Estados permitidos:

```text
pending
active
past_due
cancelled
expired
```

A restrição atual `UNIQUE(student_id, monitor_id)` permanece: existe no máximo
uma assinatura corrente por aluno e monitor. Renovações são registradas em
`student_purchases`, sem criar outra linha de acesso.

## Fluxo de compra

```text
1. Aluno escolhe monitor na vitrine
2. Frontend envia somente monitor_ids ao backend
3. Backend valida aluno, monitores publicados e assinatura existente
4. Backend calcula preços e cria student_purchases = PENDING
5. Backend cria student_purchase_items com snapshots
6. Backend cria checkout no gateway
7. Frontend redireciona ou exibe instruções de pagamento
8. Gateway envia webhook ao backend
9. Backend valida assinatura do webhook e a idempotência
10. Backend marca compra como PAID
11. Backend cria/ativa student_subscriptions em uma transação
12. /areadoaluno consulta assinaturas ativas e exibe os monitores
```

## Estados e transições

```text
PENDING → PROCESSING → PAID
PENDING → CANCELLED
PROCESSING → FAILED
PAID → REFUNDED
PAID → CANCELLED
PAID → PAID                 webhook repetido: sem efeito adicional
```

Regras:

- Apenas `PAID` libera acesso.
- `FAILED`, `CANCELLED`, `REFUNDED` e `EXPIRED` não liberam acesso novo.
- Uma confirmação repetida do mesmo evento deve retornar sucesso sem duplicar
  pedido, item ou assinatura.
- O processamento do webhook e a ativação da assinatura devem usar transação
  única.
- Falha na ativação deve manter o pagamento auditado e gerar alerta para
  reconciliação, sem apagar o pedido.

## Endpoints previstos

### Criar checkout

```http
POST /api/v1/student/purchases
Authorization: Bearer <student-token>
Idempotency-Key: <client-generated-key>
```

Body:

```json
{
  "monitorIds": ["uuid-do-monitor"],
  "paymentMethod": "PIX"
}
```

O retorno contém `purchaseId`, valor calculado pelo backend e os dados
necessários para continuar no gateway.

### Listar compras do aluno

```http
GET /api/v1/student/purchases
```

Retorna pedidos do próprio aluno, sem permitir filtrar por outro `student_id`.

### Listar monitores liberados

```http
GET /api/v1/student/subscriptions
```

Retorna somente assinaturas do aluno autenticado com estado `active`, junto
com dados públicos mínimos do monitor.

### Webhook do gateway

```http
POST /api/v1/payments/webhooks/<provider>
```

O endpoint não usa sessão do aluno. Deve validar assinatura, evento, valor,
moeda, pedido externo e `gateway_payment_id` antes de alterar qualquer estado.

## Segurança e autorização

- O aluno só pode criar, consultar e cancelar seus próprios pedidos e acessos.
- O `monitor_id` recebido do frontend deve ser revalidado no backend.
- O preço recebido do frontend deve ser ignorado para fins de cobrança.
- Webhooks devem ser autenticados pela assinatura oficial do gateway.
- Dados sensíveis do pagamento não devem ser armazenados; guardar somente
  identificadores e metadados necessários para reconciliação.
- Logs não devem conter número completo de cartão, CVV, tokens secretos ou
  payloads sensíveis.
- A leitura em `/areadoaluno` deve usar a identidade do token, nunca um
  `student_id` enviado pelo cliente.

## Compatibilidade com o código atual

- `StudentRepository.createSubscription` deve deixar de ser a operação
  principal do checkout e passar a ser chamada pelo serviço de confirmação de
  pagamento.
- `amountPaid` em `student_subscriptions` não deve ser usado como histórico;
  será mantido apenas temporariamente para compatibilidade ou removido em uma
  migração posterior.
- O checkout frontend atual deve deixar de simular aprovação com `setTimeout`.
- O caminho de sucesso deve redirecionar para `/areadoaluno` somente após o
  backend confirmar o estado `PAID`.
- A área do aluno deve consumir assinaturas ativas, sem assumir dados fixos de
  demonstração quando a integração for ligada.

## Critérios de aceite

- Um aluno autenticado consegue iniciar uma compra com um ou mais monitores
  publicados.
- O backend calcula e persiste o valor correto em centavos.
- O pedido mantém snapshot dos itens e preços contratados.
- Repetir a mesma requisição com a mesma `Idempotency-Key` não cria segundo
  pedido.
- Repetir o mesmo webhook não cria nova assinatura nem duplica pagamento.
- Somente uma compra `PAID` ativa o acesso em `student_subscriptions`.
- A área `/areadoaluno` lista os monitores ativos do aluno.
- Compra cancelada, falha, expirada ou reembolsada não aparece como acesso
  ativo.
- Um aluno não consegue consultar ou ativar monitor pertencente a outro aluno.
- O fluxo possui testes de transição de estado, autorização e idempotência.

## Fora do escopo do MVP

- Marketplace público e divisão automática de comissão com professores.
- Cupons, impostos, chargeback automatizado e múltiplas moedas.
- Compra única ou planos anuais.
- Migração automática de assinaturas antigas sem pedido associado.
- Armazenamento de dados de cartão.
- Implementação específica de Stripe, Mercado Pago ou outro gateway antes da
  escolha formal do provedor.

## Adendo: checkout Stripe simulado

Nesta etapa haverá somente uma simulação local do comportamento de checkout da
Stripe. Nenhuma chamada à Stripe será realizada, nenhuma chave da Stripe será
necessária e nenhum pagamento real será processado.

### Comportamento esperado

```text
vitrine
→ backend cria pedido PENDING
→ backend valida aluno, monitor, preço e assinatura existente
→ backend cria uma sessão simulada
→ frontend exibe uma tela de checkout semelhante à Stripe
→ aluno escolhe uma forma de pagamento fictícia
→ backend recebe a confirmação simulada
→ backend valida a sessão e o valor
→ backend marca o pedido como PAID em modo de teste
→ backend libera student_subscriptions
→ frontend redireciona para /areadoaluno
```

### Regras de segurança da simulação

- O frontend nunca cria diretamente `student_purchases` ou
  `student_subscriptions`.
- O frontend nunca define preço, desconto, moeda, aluno ou monitor na etapa de
  confirmação.
- O backend deve buscar o preço e o status do monitor no banco ao criar o
  pedido.
- A sessão simulada deve possuir um identificador aleatório, validade curta e
  vínculo com `purchase_id` e `student_id`.
- A confirmação simulada deve exigir autenticação do próprio aluno e validar
  que a sessão pertence ao pedido pendente correto.
- O backend deve rejeitar confirmação de sessão expirada, inexistente, já
  concluída ou pertencente a outro aluno.
- O modo simulado deve ser protegido por configuração explícita de ambiente,
  como `PAYMENTS_SIMULATION_ENABLED=true`, e nunca ficar habilitado
  implicitamente em produção.
- As rotas simuladas devem identificar claramente que são de teste e não devem
  ser apresentadas como confirmação de pagamento real.
- Nenhum dado de cartão, CVV, número bancário ou credencial de pagamento deve
  ser solicitado ou armazenado.
- A simulação deve usar a mesma transação de ativação e as mesmas regras de
  idempotência previstas para o webhook real.

### Endpoints simulados

```http
POST /api/v1/student/purchases
POST /api/v1/student/purchases/:purchaseId/simulated-checkout
POST /api/v1/student/purchases/:purchaseId/simulated-confirmation
```

O primeiro endpoint cria o pedido e a sessão simulada. O segundo representa a
abertura/continuação do checkout. O terceiro confirma o pagamento fictício e
deve executar no backend as mesmas validações que futuramente serão usadas no
adaptador de webhook da Stripe.

### Critérios de aceite do modo simulado

- O usuário consegue percorrer uma tela de checkout semelhante à Stripe sem
  qualquer integração externa.
- O preço exibido e confirmado é sempre o preço calculado pelo backend.
- Alterar o payload no navegador não altera o valor nem o monitor do pedido.
- Uma confirmação válida ativa o acesso somente uma vez.
- Repetir a confirmação não duplica compra nem assinatura.
- Sessão inválida, expirada ou de outro aluno retorna erro e não libera acesso.
- O modo simulado pode ser desligado por ambiente sem alterar o fluxo real
  futuro.
- A implementação deixa um adaptador isolado para substituição posterior pela
  integração oficial da Stripe.

## Sequência de implementação posterior

1. Escolher o gateway e documentar seus eventos e requisitos de webhook.
2. Criar migration para compras, itens e campos de assinatura.
3. Implementar repositórios e serviço transacional de checkout.
4. Implementar webhook idempotente e reconciliação.
5. Expor endpoints autenticados do aluno.
6. Substituir a simulação do checkout frontend.
7. Conectar `/areadoaluno` às assinaturas reais.
8. Executar testes unitários, integração de webhook e teste manual completo.
