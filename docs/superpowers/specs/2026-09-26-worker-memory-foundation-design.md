# Fundação de memória e observabilidade do worker

## Objetivo

Eliminar referências permanentes a layouts e requisições encerradas, medir a memória real do processo e controlar a concorrência de documentos sem alterar o comportamento das filas de simulados e pagamentos.

Esta especificação cobre `WM-01`, `WM-02` e `WM-05` da especificação geral. Otimização de imagem Docker, dependências Python e separação de containers permanecem fora do escopo.

## Estado atual confirmado

- `MineruParserAdapter.inlineResults` nunca remove layouts concluídos.
- `inFlightParses` remove Promises em `finally`, mas o timeout do orquestrador não cancela o `fetch` subjacente.
- `worker.ts` fixa concorrência de documentos em `2`.
- O heartbeat registra presença no Redis, mas não RSS, heap, buffers ou jobs ativos.
- `worker.ts` abre conexões e inicia timers no import, dificultando testes isolados.

## Contratos

### Resultado inline e deduplicação

`ParseSubmission.result` é o único transporte em memória de um resultado inline. O adaptador não mantém cache de layouts concluídos.

```ts
export type ParseExecutionOptions = {
  signal?: AbortSignal;
};

export interface DocumentParserAdapter {
  readonly name: DocumentParserName;
  parse(input: ParseInput, options?: ParseExecutionOptions): Promise<ParseSubmission>;
  getStatus(parseRunId: string, statusUrl?: string): Promise<ParseStatus>;
  getResult(parseRunId: string, resultUrl?: string): Promise<LayoutDocument>;
  close?(): Promise<void>;
}
```

O `MineruParserAdapter` mantém somente requisições ativas:

```ts
type InFlightParse = {
  promise: Promise<ParseSubmission>;
  controller: AbortController;
};
```

Invariantes:

- uma chave idempotente gera no máximo uma submissão HTTP simultânea;
- consumidores simultâneos recebem a mesma Promise;
- a entrada desaparece após sucesso, falha, abort ou resposta inválida;
- `close()` rejeita novas submissões, aborta requests ativos e aguarda `allSettled`;
- abort de shutdown não deixa `FormData`, bytes ou Promise referenciados;
- `getResult` consulta apenas resultado remoto; resultado inline é consumido de `submission.result` pelo orquestrador.

O timeout deve propagar `AbortSignal` até o `fetch`. Um `Promise.race` sem cancelamento não satisfaz o contrato.

### Rastreamento de jobs ativos

```ts
export type WorkerQueueName = 'documents' | 'weekly_simulations' | 'payment_webhooks';

export type WorkerQueueStats = {
  active: number;
  started: number;
  completed: number;
  failed: number;
};

export interface WorkerJobTracker {
  run<T>(queue: WorkerQueueName, action: () => Promise<T>): Promise<T>;
  snapshot(): Readonly<Record<WorkerQueueName, WorkerQueueStats>>;
}
```

`run` incrementa `started` e `active` antes da action, incrementa `completed` ou `failed` e sempre decrementa `active` em `finally`. Eventos BullMQ não são a fonte do contador porque `stalled`, retries e atraso de eventos podem causar dupla contagem. `active` nunca pode ser negativo.

### Snapshot de memória

```ts
export type WorkerMemoryStage =
  | 'boot'
  | 'idle'
  | 'document_download_started'
  | 'document_download_completed'
  | 'document_parse_started'
  | 'document_parse_completed'
  | 'document_persist_completed'
  | 'document_job_completed'
  | 'document_job_failed'
  | 'shutdown';

export type WorkerMemoryEvent = {
  event: 'monitor.worker_memory';
  sampledAt: string;
  stage: WorkerMemoryStage;
  pid: number;
  uptimeSeconds: number;
  nodeVersion: string;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  activeJobs: number;
  queues: Readonly<Record<WorkerQueueName, WorkerQueueStats>>;
  documentId?: string;
  jobId?: string;
  attempt?: number;
};
```

Criar `src/health/worker-memory.ts` com:

```ts
export function createWorkerMemoryMonitor(options: {
  intervalMs: number;
  tracker: WorkerJobTracker;
  memoryUsage?: () => NodeJS.MemoryUsage;
  now?: () => Date;
  logger?: (event: WorkerMemoryEvent) => void;
}): {
  start(): void;
  sample(stage: WorkerMemoryStage, context?: DocumentMemoryContext): WorkerMemoryEvent;
  stop(): void;
};
```

Regras:

- amostra no boot, a cada 30 segundos e nas fronteiras do documento;
- timer usa `unref` e é encerrado no shutdown;
- o monitor não mantém histórico local;
- falha do logger é capturada e não afeta jobs;
- não incluir PDF, texto, layout, URL assinada, credencial ou payload;
- `external` e `arrayBuffers` são reportados separadamente, sem soma;
- heartbeat atual permanece compatível e separado da telemetria.

### Configuração de concorrência

Adicionar somente:

```ts
DOCUMENT_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2)
WORKER_MEMORY_INTERVAL_MS: z.coerce.number().int().positive().default(30_000)
```

O valor efetivo deve alimentar o `Worker` de documentos e o log de boot. Simulados continuam em `2` e pagamentos em `4`.

Para permitir teste, extrair uma factory pura:

```ts
export function createDocumentWorkerOptions(
  connection: Redis,
  concurrency: number,
): WorkerOptions;
```

## Shutdown

O escopo de shutdown limita-se aos recursos introduzidos ou diretamente necessários para liberar memória do parser:

1. parar telemetria, heartbeat, scheduler e recovery timer;
2. fechar consumidores BullMQ, aguardando jobs ativos;
3. fechar/abortar o adaptador do parser se o drain não terminar;
4. encerrar Redis e Prisma.

O handler deve ser idempotente: chamadas concorrentes retornam a mesma Promise. O helper testável não chama `process.exit`; o entrypoint define `process.exitCode` após a limpeza.

## TDD obrigatório

### RED

- 100 respostas inline deixam zero resultados em estado do adaptador.
- duas submissões simultâneas com a mesma chave fazem um único `fetch`.
- sucesso, erro HTTP, JSON inválido e abort deixam `inFlightParses` vazio.
- timeout aborta o signal observado pelo `fetch`.
- tracker mostra `active=2`, depois `1`, depois `0` em actions controladas.
- rejection incrementa `failed` e restaura `active=0`.
- snapshot contém todos os campos numéricos e nenhum dado sensível.
- `stop()` impede novas amostras periódicas.
- concorrência ausente usa `2`; `1` é aceita; `0`, fração e `9` falham.
- duas chamadas de shutdown fecham cada recurso apenas uma vez.

### GREEN

Implementar a menor mudança que satisfaça cada teste. Não introduzir cache com TTL, backpressure por RSS ou configuração das outras filas.

### REFACTOR

Remover duplicação, manter funções puras e repetir os testes focados, parser unitário, typecheck e lint.

## Critérios de aceite

- `inlineResults` não existe.
- nenhuma request ativa permanece referenciada após seus quatro desfechos.
- deduplicação concorrente permanece funcional.
- telemetria é determinística em teste e inofensiva em falha.
- concorrência default continua `2`.
- comportamento de retry do BullMQ e heartbeat existente não muda.
- nenhum teste determinístico abre Redis, PostgreSQL, parser real ou LLM.

