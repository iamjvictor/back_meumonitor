# Desafio diário — funcionamento implementado

Este documento descreve o fluxo atual de geração, entrega, resposta e ranking do desafio diário.

## 1. Regra do produto

O sistema gera uma questão por dia para cada monitor `PUBLISHED`. A questão:

- é igual para todos os alunos daquele monitor;
- pertence ao monitor;
- possui `status = APPROVED`;
- pode vir de qualquer categoria ou tópico;
- é escolhida aleatoriamente;
- nunca é reutilizada como desafio naquele monitor;
- fica disponível até `23:59:59` da data local.

Cada aluno pode responder uma única vez. Respostas normais e simulados não entram no ranking.

### Sobre os timestamps exibidos no banco

`available_from` e `available_until` são armazenados como `TIMESTAMPTZ`. O desafio usa a meia-noite de São Paulo, mas o cliente SQL pode exibir o instante em UTC.

Por isso, um desafio do dia `2026-09-04` aparece assim:

```text
available_from:  2026-09-04 03:00:00 UTC
available_until: 2026-09-05 02:59:59.999 UTC
```

A conversão para o horário brasileiro é:

```text
2026-09-04 00:00:00 America/Sao_Paulo
2026-09-04 23:59:59.999 America/Sao_Paulo
```

É o mesmo intervalo. São Paulo está três horas atrás do UTC, portanto `03:00 UTC` corresponde à meia-noite para o aluno. A coluna `challenge_date` continua registrando a data local oficial do desafio.

## 2. Arquivos do módulo

O módulo está em `backend/src/modules/daily_challgens/`.

| Arquivo | Função |
|---|---|
| `services/daily-challenge-selection.service.ts` | Seleção aleatória e janela de São Paulo |
| `services/daily-challenge-generation.service.ts` | Gera e persiste um desafio por monitor |
| `services/daily-challenge-scheduler.service.ts` | Agenda a execução diária |
| `services/daily-challenge.service.ts` | Consulta e resposta do aluno |
| `repositories/daily-challenge.repository.ts` | Consultas e transação de respostas |
| `repositories/daily-challenge-ranking.repository.ts` | Ranking mensal |
| `controllers/daily-challenge.controller.ts` | Tratamento HTTP |
| `routes/daily-challenge.routes.ts` | Rotas Fastify |
| `daily-challgens.module.ts` | Registro do módulo |

O scheduler é iniciado em `backend/src/worker.ts`.

## 3. Scheduler

O worker inicia:

```ts
const dailyChallengeScheduler = startDailyChallengeScheduler();
```

O scheduler calcula a próxima meia-noite em:

```text
America/Sao_Paulo
```

Ele usa um `setTimeout` de execução única e recalcula o próximo horário depois de cada ciclo. À meia-noite chama:

```ts
new DailyChallengeGenerationService().generateForDate()
```

O worker precisa estar ativo:

```bash
cd backend
npm run worker:dev
```

Se o worker estiver desligado à meia-noite, a implementação atual não faz recuperação automática imediata ao iniciar. Essa melhoria ainda está pendente.

## 4. Geração por monitor

Para cada monitor publicado, o serviço:

1. calcula a data local de São Paulo;
2. verifica se já existe um desafio para aquele monitor/data;
3. busca questões `APPROVED` do monitor;
4. remove questões já presentes em `daily_challenges` daquele monitor;
5. sorteia uma questão;
6. grava o desafio;
7. registra o resultado nos logs.

Não há prioridade por categoria, tópico, frequência, dificuldade ou desempenho. A seleção é aleatória dentro do conjunto elegível.

Quando o banco de questões elegíveis acaba, o sistema não repete uma questão. Registra `NO_ELIGIBLE_QUESTION` e continua os demais monitores.

## 5. Idempotência

O banco possui:

```text
UNIQUE (monitor_id, challenge_date)
UNIQUE (monitor_id, question_id)
```

A primeira restrição impede dois desafios no mesmo monitor/data. A segunda impede reutilizar a questão naquele monitor.

Portanto, se o job rodar novamente, ele encontra o desafio existente e não cria duplicidade.

## 6. Tabelas

### `daily_challenges`

Registro oficial da questão diária de um monitor.

Armazena:

- `monitor_id`;
- `question_id`;
- `challenge_date`;
- `available_from`;
- `available_until`;
- `selection_strategy`;
- timestamps.

### `student_question_attempts`

Histórico geral de respostas do aluno. Para desafios, usa:

```text
mode = DAILY_CHALLENGE
```

Armazena aluno, questão, monitor, desafio relacionado, alternativa escolhida, acerto/erro, tempo e horário.

O resultado é calculado no backend comparando com `questions.correct_answer`.

### `daily_challenge_attempts`

Registro da participação no desafio e fonte do ranking.

Armazena:

- desafio;
- aluno;
- `question_attempt_id`;
- acerto/erro;
- horário da resposta.

Possui:

```text
UNIQUE (daily_challenge_id, student_id)
```

As duas tabelas de tentativa são preenchidas dentro da mesma transação Prisma.

## 7. Consulta em lote do aluno

Endpoint:

```http
GET /api/v1/student/daily-challenges
```

O backend não confia em um array de monitores enviado pelo frontend. Ele:

```text
sessão
  ↓
student
  ↓
student_enrollments ACTIVE
  ↓
monitores autorizados
  ↓
daily_challenges da data atual
  ↓
remove desafios já respondidos
  ↓
retorna um array pendente
```

Se o aluno tiver três monitores e ainda não respondeu nenhum, recebe três desafios. Se respondeu um, recebe dois. Se respondeu todos, recebe um array vazio.

## 8. Resposta

Endpoint:

```http
POST /api/v1/student/daily-challenges/:challengeId/answer
```

Payload:

```json
{
  "selectedAnswer": "B",
  "responseTimeMs": 42000
}
```

O backend:

1. valida sessão;
2. resolve o aluno;
3. valida enrollment ativo;
4. valida desafio e janela de disponibilidade;
5. verifica resposta anterior;
6. calcula o resultado usando o gabarito do banco;
7. cria `student_question_attempts`;
8. cria `daily_challenge_attempts`;
9. retorna resultado, gabarito e explicação.

Uma segunda submissão não cria novos registros e retorna o resultado já salvo.

## 9. Ranking

Endpoint:

```http
GET /api/v1/student/monitors/:monitorId/daily-challenge/ranking?month=2026-09
```

O ranking consulta somente `daily_challenge_attempts` corretas e filtra por monitor e mês.

```text
1 acerto = 1 ponto
```

Respostas de prática, simulados e flashcards não pontuam no ranking.

## 10. Frontend

O dashboard consulta o endpoint em lote. Cada desafio pendente gera um banner.

Ao clicar em `Responder agora`:

1. abre o modal;
2. exibe matéria, tópico, enunciado e alternativas;
3. permite selecionar uma alternativa;
4. envia a resposta ao backend;
5. mostra a correta em verde;
6. mostra a escolha errada em vermelho;
7. mostra a explicação armazenada na questão.

O modal fecha pelo `X` ou clicando fora do card.

## 11. Logs

Geração:

```text
monitor.daily_challenge_generation_started
monitor.daily_challenge_monitors_loaded
monitor.daily_challenge_selection_started
monitor.daily_challenge_created
monitor.daily_challenge_already_exists
monitor.daily_challenge_no_eligible_question
monitor.daily_challenge_generation_completed
monitor.daily_challenge_generation_failed
```

Consulta:

```text
monitor.daily_challenge_http_batch_get_started
monitor.daily_challenge_access_validated
monitor.daily_challenge_batch_loaded
monitor.daily_challenge_loaded
```

Resposta:

```text
monitor.daily_challenge_http_answer_started
monitor.daily_challenge_answer_validated
monitor.daily_challenge_question_attempt_created
monitor.daily_challenge_attempt_created
monitor.daily_challenge_performance_updated
monitor.daily_challenge_already_answered
monitor.daily_challenge_http_failed
```

## 12. Teste manual

Gerar o desafio atual manualmente:

```bash
cd backend
npx tsx -e 'import { DailyChallengeGenerationService } from "./src/modules/daily_challgens/services/daily-challenge-generation.service.ts"; import { prisma } from "./src/lib/prisma.ts"; (async()=>{ console.log(await new DailyChallengeGenerationService().generateForDate(new Date())); await prisma.$disconnect(); })();'
```

Conferir os desafios:

```sql
SELECT dc.id, dc.monitor_id, dc.question_id, dc.challenge_date,
       dc.available_from, dc.available_until, q.status, q.text
FROM public.daily_challenges dc
JOIN public.questions q ON q.id = dc.question_id
ORDER BY dc.challenge_date DESC, dc.monitor_id;
```

Conferir respostas:

```sql
SELECT dca.daily_challenge_id, dca.student_id,
       dca.question_attempt_id, dca.is_correct,
       sqa.selected_answer, sqa.mode, dca.answered_at
FROM public.daily_challenge_attempts dca
JOIN public.student_question_attempts sqa ON sqa.id = dca.question_attempt_id
ORDER BY dca.answered_at DESC;
```

## 13. Limitações atuais

- Ainda não há recuperação automática de ciclos perdidos quando o worker fica desligado.
- Métricas de desempenho e constância do dashboard ainda possuem partes mockadas.
- Streak/constância ainda não está implementado.
- Não há desempate avançado no ranking.
- Flashcards ainda não possuem histórico de revisão espaçada do aluno.
