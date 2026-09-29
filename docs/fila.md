# Filas e processamento assíncrono

Este documento descreve o funcionamento atual das filas do MeuMonitorAI. A implementação usa BullMQ sobre Redis compatível com Redis, atualmente hospedado no Upstash, e um worker Node.js separado da API.

## Visão geral

```text
                                  ┌─────────────────────────┐
                                  │ API Fastify             │
                                  │                         │
 Upload de documento ────────────┤ documentQueue           │
 Solicitação de simulado ────────┤ weeklySimulationQueue   │
 Webhook Asaas recebido ─────────┤ paymentWebhookQueue     │
                                  └───────────┬─────────────┘
                                              │ jobs Redis
                                              ▼
                                  ┌─────────────────────────┐
                                  │ Redis / Upstash         │
                                  │ chaves bull:*           │
                                  └───────────┬─────────────┘
                                              │ BZPOPMIN + scripts BullMQ
                                              ▼
                                  ┌─────────────────────────┐
                                  │ backend/src/worker.ts   │
                                  │                         │
                                  │ documentos (2)          │
                                  │ simulados (2)           │
                                  │ pagamentos (4)          │
                                  └───────────┬─────────────┘
                                              │
                                              ▼
                                  PostgreSQL / Supabase
```

A fila é usada para desacoplar a resposta HTTP de tarefas demoradas. A API grava o estado durável no PostgreSQL e publica um job no Redis. O worker consome o job, executa o serviço correspondente e atualiza o PostgreSQL.

O Redis não é a fonte de verdade dos documentos, simulados ou pagamentos. Ele funciona como transporte e coordenação temporária. Os estados duráveis ficam no banco.

## Filas existentes

| Fila | Nome Redis | Produtor | Consumidor | Concorrência | Tentativas padrão |
|---|---|---|---|---:|---:|
| Documentos | `monitor-documents` | `DocumentService` | `DocumentWorkerService` | 2 | 3 |
| Simulados semanais | `monitor-weekly-simulations` | `WeeklySimulationGenerationService` | `WeeklySimulationWorkerService` | 2 | 3 |
| Webhooks de pagamento | `payments-webhooks` | `AsaasWebhookIngress` e recuperação | `ProcessPaymentWebhookUseCase` | 4 | 5 |

As definições das filas ficam em:

- `src/queues/document.queue.ts`
- `src/queues/weekly-simulation.queue.ts`
- `src/modules/payments/jobs/payment-webhook.queue.ts`

Todas usam `REDIS_URL` e conexões TCP/TLS do `ioredis`. Os produtores da API mantêm conexões próprias para publicar jobs. O worker compartilha uma conexão entre documentos e simulados e usa uma conexão separada para webhooks de pagamento.

## 1. Fila de documentos

### Publicação

O fluxo começa em `DocumentService.upload`:

1. o arquivo é persistido no Supabase Storage e o documento é criado no PostgreSQL com status `QUEUED`;
2. a API publica `process-document` na fila `monitor-documents`;
3. o `jobId` normal é o próprio `documentId`, evitando publicação duplicada;
4. a API retorna o documento sem esperar o processamento completo.

O reprocessamento publica um novo job com um identificador baseado no documento e no horário. Nesse caso são usadas duas tentativas e backoff exponencial de 1 segundo.

### Consumo

O worker chama:

```ts
workerService.process(job.data.documentId, {
  jobId: job.id,
  attempt: job.attemptsMade + 1,
});
```

O processamento pode incluir download do arquivo, parser, normalização, blocos, chunks, embeddings, questões, respostas e flashcards. O estado detalhado de cada operação é persistido em `DocumentProcessingJob`.

Estados principais do documento:

```text
QUEUED → PROCESSING → READY
                  ├→ PARTIAL_SUCCESS
                  ├→ NEEDS_OCR
                  └→ FAILED
```

Estados das operações individuais:

```text
QUEUED → PROCESSING → READY
                  ├→ PARTIAL_SUCCESS
                  ├→ SKIPPED
                  └→ FAILED
```

Se o job falhar após esgotar as tentativas, o worker marca o documento como `FAILED` no PostgreSQL. O evento `failed` também registra `jobId`, `documentId`, número de tentativas e erro.

### Retenção

- jobs concluídos: no máximo 1.000 ou 1 hora;
- jobs falhos: no máximo 5.000 ou 7 dias.

Essa retenção remove metadados antigos da fila, mas não remove os dados duráveis do documento no PostgreSQL ou no Storage.

## 2. Fila de simulados semanais

### Publicação

`WeeklySimulationGenerationService` cria ou reutiliza um registro `WeeklySimulation` com status `PENDING` e publica:

```text
fila: monitor-weekly-simulations
nome: generate-weekly-simulation
payload: { simulationId }
jobId: weekly-simulation-{simulationId}
```

O `generationJobId` também fica persistido no PostgreSQL para manter a associação entre o simulado e a geração.

### Consumo

`WeeklySimulationWorkerService` marca o simulado como `PROCESSING`, seleciona questões, grava os itens e termina em `READY`. Em caso de erro, o registro fica `FAILED` com código e mensagem.

Durante a resolução pelo aluno, os estados são:

```text
PENDING → PROCESSING → READY → IN_PROGRESS → COMPLETED
                         └→ FAILED
```

Essa fila é independente da fila de documentos, mas usa a mesma conexão Redis compartilhada pelo worker.

## 3. Fila de webhooks de pagamento

### Entrada

O webhook Asaas é primeiro persistido em `PaymentWebhookEvent`. O registro começa em `RECEIVED` e recebe uma chave de idempotência baseada no ambiente, conta e `providerEventId`.

Somente depois da persistência a API publica o job:

```text
fila: payments-webhooks
nome: process-payment-webhook
payload: { eventId }
jobId normal: eventId
jobId de recuperação: {eventId}:recovery:{timestamp}
```

Se o mesmo webhook chegar novamente, a chave única evita duplicação do evento e o ingresso não deve criar outro processamento lógico.

### Consumo e lease

O worker chama `ProcessPaymentWebhookUseCase`. Antes de processar, o repositório tenta reivindicar o evento com um lease de cinco minutos:

```text
RECEIVED → PROCESSING → PROCESSED
                   ├→ FAILED
                   └→ WAITING_CORRELATION
```

O lease permite que outro processamento recupere um evento abandonado depois que o prazo expirar. O tratamento do evento atualiza acesso, pagamentos, assinaturas ou contas Asaas no PostgreSQL.

### Recuperação

Além do consumidor BullMQ, o worker executa `PaymentWebhookRecoveryJob` a cada 60 segundos. Ele procura eventos recuperáveis no PostgreSQL e republica jobs com `recovery: true`.

Esse mecanismo é importante porque o webhook já está salvo no banco mesmo que a publicação no Redis falhe.

## Como o worker espera por jobs

Cada `Worker` do BullMQ mantém uma conexão bloqueante e utiliza `BZPOPMIN` para aguardar o marcador da fila. Isso não é uma requisição HTTP repetida, mas cada expiração do bloqueio ainda conta como comando no Upstash.

As opções temporárias atuais estão centralizadas em `src/worker/worker-options.ts`:

```ts
drainDelay: 60             // segundos em fila ociosa
stalledInterval: 300_000   // cinco minutos
```

O `drainDelay` afeta principalmente uma fila vazia. Quando um job novo publica o marcador correspondente, o worker pode ser acordado antes de completar os 60 segundos. Jobs atrasados podem usar um bloqueio menor para respeitar o vencimento.

O worker também mantém um heartbeat:

```text
chave: monitor:worker:heartbeat:v1
intervalo: 60 segundos
TTL: 180 segundos
```

A rota `/health/worker` lê essa chave para indicar se o worker publicou presença recentemente.

## Consumo no Upstash

O plano gratuito da Upstash possui limite mensal de comandos. O consumo não vem apenas de chamadas explícitas de `get` ou `set` da aplicação. BullMQ também gera comandos para:

- aguardar jobs (`BZPOPMIN`);
- mover jobs para `active`;
- renovar locks;
- verificar jobs travados;
- executar retries e backoff;
- limpar jobs antigos;
- publicar heartbeat.

Com três workers permanentes, existe consumo mesmo sem usuários ativos. O ajuste atual de 60 segundos reduz o consumo ocioso, mas não elimina os comandos de BullMQ. Jobs reais, retries, deploys duplicados e filas com tarefas atrasadas aumentam o total.

O erro abaixo significa que o limite mensal já foi atingido:

```text
ERR max requests limit exceeded. Limit: 500000
```

Depois disso, as leituras bloqueantes continuam falhando e os eventos `error` dos workers podem aparecer repetidamente nos logs. Não é um erro do payload do job; é uma recusa do Redis por limite de uso.

## Falhas e recuperação

### Redis indisponível ao publicar

- upload de documento pode retornar erro de publicação mesmo que o arquivo já tenha sido salvo;
- criação de simulado pode permanecer `PENDING` sem job publicado;
- webhook continua persistido no PostgreSQL e pode ser recuperado pelo mecanismo de recuperação;
- chat e caches Redis ficam indisponíveis até a reconexão.

### Redis indisponível durante o consumo

- o worker emite erro de conexão;
- BullMQ tenta reconectar conforme as opções do `ioredis`;
- jobs já persistidos no Redis aguardam o retorno da conexão;
- o PostgreSQL continua contendo os estados duráveis, mas documentos e simulados não avançam enquanto o consumidor não processar os jobs.

### Reinício do worker

O shutdown fecha os três consumidores, o heartbeat, o scheduler, o timer de recuperação, as conexões Redis e o Prisma. O BullMQ mantém jobs não concluídos no Redis para que sejam retomados por uma nova instância.

## Operação e diagnóstico

Para conferir o processo sem expor credenciais:

```bash
cd backend
npm run typecheck
```

Para conferir chaves de filas, use uma conexão autenticada e restrinja o padrão:

```bash
redis-cli --tls -u "$REDIS_URL" --scan --pattern 'bull:*'
```

Não use `KEYS bull:*` em produção. O padrão de chaves BullMQ costuma incluir:

```text
bull:monitor-documents:*
bull:monitor-weekly-simulations:*
bull:payments-webhooks:*
```

Antes de remover chaves antigas, confirme que não existem jobs necessários aguardando processamento. A limpeza de chaves Redis não remove os documentos, simulados ou eventos já persistidos no PostgreSQL, mas pode remover jobs que ainda não foram consumidos.

## Decisões atuais e próximos limites

Esta arquitetura continua usando Redis como transporte das filas porque preserva processamento assíncrono, retries e baixa latência. O ajuste de polling é uma medida temporária para reduzir o consumo no Free Tier.

Se o uso real crescer, as alternativas são:

1. ativar Pay as You Go na Upstash;
2. usar um plano fixo de Redis;
3. migrar o dispatcher de jobs para filas persistidas no PostgreSQL;
4. separar filas de documentos, simulados e pagamentos em serviços com ciclo de vida independente.

Enquanto o Free Tier for prioridade, evite manter múltiplas réplicas do worker sem necessidade: cada réplica cria seus próprios consumidores, locks e verificações BullMQ.
