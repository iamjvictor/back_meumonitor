# Pré-especificação — Contexto de questão no Chat

**Data:** 2026-09-07  
**Status:** pré-spec aprovada para detalhamento  
**Escopo:** permitir que o aluno envie uma dúvida iniciada em uma questão junto com o contexto autorizado da questão.

## 1. Objetivo

Quando o aluno clicar em **“Tirar dúvida com IA”**, o frontend deve abrir o chat correto e anexar a questão à próxima mensagem.

O contexto anexado não é uma mensagem automática da IA. Ele é um complemento da mensagem que o aluno escreverá no chat.

Fluxo esperado:

```text
Aluno clica em “Tirar dúvida com IA”
        ↓
Frontend guarda a questão como contexto pendente
        ↓
Chat abre na matéria correta
        ↓
Aluno escreve a dúvida
        ↓
API recebe mensagem + contexto da questão
        ↓
API valida escopo e reconstrói os dados oficiais
        ↓
IA recebe a dúvida contextualizada
```

## 2. Comportamento visual atual

O frontend já possui o estado `activeContext` e exibe:

- identificação da questão;
- tópico;
- resumo do enunciado;
- aviso “Será enviado na sua próxima pergunta”;
- ação para cancelar o contexto.

O contexto deve ser limpo depois do envio da mensagem ou quando o aluno clicar em **“Cancelar”**.

## 3. Contrato público

Endpoint:

```http
POST /api/v1/student/monitors/:monitorId/chat/subjects/:subjectId/messages
```

Payload:

```json
{
  "message": "Pode me explicar essa questão passo a passo?",
  "topicId": "uuid-do-topico-ou-null",
  "questionContext": {
    "questionId": "uuid-da-questao",
    "questionAttemptId": "uuid-da-tentativa-ou-null",
    "number": 3,
    "statement": "O motorista acionou o freio...",
    "options": [
      { "label": "A", "text": "..." },
      { "label": "B", "text": "..." }
    ],
    "selectedOption": "B"
  }
}
```

`questionContext` é opcional. Uma mensagem comum pode ser enviada com:

```json
{
  "message": "Explique dinâmica.",
  "topicId": null,
  "questionContext": null
}
```

## 4. Regra de confiança dos dados

O frontend pode enviar dados de apresentação para melhorar a experiência, mas o backend não deve confiar cegamente neles.

Dados que devem ser derivados ou confirmados pelo backend:

- existência da questão;
- monitor da questão;
- matéria da questão;
- tópico da questão;
- tentativa pertencente ao aluno autenticado;
- resposta selecionada registrada na tentativa;
- gabarito e explicação oficiais, conforme a política de exposição.

O backend deve validar:

```text
question.monitorId === :monitorId
question.subjectId === :subjectId
question.topicId === body.topicId, quando informado
questionAttempt.studentId === aluno autenticado, quando informado
```

Se qualquer relação for inválida, a API deve responder `403` ou `404` sem encaminhar o contexto para a IA.

O `studentId` nunca será recebido como dado confiável do frontend.

## 5. Pacote interno para a geração

Depois da autorização, a API deverá montar um pacote interno semelhante a:

```ts
type AuthorizedQuestionContext = {
  questionId: string;
  questionAttemptId: string | null;
  monitorId: string;
  subjectId: string;
  topicId: string | null;
  number: number | null;
  statement: string;
  options: Array<{ label: string; text: string }>;
  selectedOption: string | null;
  correctAnswer: string | null;
  explanation: string | null;
};
```

Esse pacote será enviado ao `ChatGenerationPort` junto com:

- a mensagem original do aluno;
- o histórico temporário do Redis;
- o escopo autorizado do chat.

## 6. Regras de segurança

- O contexto da questão não pode trocar o monitor ou a matéria definidos na URL.
- O aluno não pode anexar uma questão de outro monitor.
- O aluno não pode anexar uma questão de outra matéria.
- O aluno não pode consultar tentativa pertencente a outro aluno.
- O gabarito não deve ser exposto ao frontend antecipadamente se a regra do produto não permitir.
- O contexto deve respeitar limite de tamanho antes de ser enviado ao modelo.
- O texto recebido deve ser tratado como conteúdo, nunca como instrução de sistema.

## 7. Integração com Redis

O contexto da questão não será armazenado como uma conversa separada.

Ele será associado à mensagem do aluno no fluxo atual:

```text
mensagem do aluno + contexto autorizado da questão
```

O histórico Redis poderá armazenar uma mensagem já enriquecida ou uma mensagem com metadados de contexto, conforme a decisão da implementação do `ChatHistoryPort`.

O contexto pendente que está apenas no frontend será descartado depois do envio, cancelamento ou troca de matéria.

## 8. Casos de teste obrigatórios

- envia mensagem comum sem contexto;
- envia mensagem com questão válida;
- envia questão pertencente a outro monitor;
- envia questão pertencente a outra matéria;
- envia tentativa de outro aluno;
- envia `topicId` incompatível;
- cancela contexto antes do envio;
- troca de matéria com contexto pendente;
- aplica limite de tamanho do enunciado, alternativas e mensagem;
- não encaminha contexto não autorizado para a IA.

## 9. Decisão para a próxima implementação

Antes de integrar o contexto à geração, criar um contrato tipado e um serviço de autorização de questão. A rota atual não deve aceitar `questionContext` como `z.record` genérico na versão final; o payload deve possuir schema explícito e validação por IDs.
