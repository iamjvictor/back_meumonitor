# Spec — Gateway de IA do Chat

**Data:** 2026-09-07  
**Status:** implementada na V1  
**Escopo:** conectar o chat autenticado ao provedor de IA usando o histórico temporário do Redis.

## Objetivo

Substituir o retorno `501 CHAT_GENERATION_NOT_IMPLEMENTED` por uma geração real, mantendo a rota pública desacoplada do OpenRouter e preparada para uma futura extração do chat para outro serviço.

## Decisão arquitetural

O gateway será um adapter interno do módulo `chat`, executado no mesmo processo da API nesta fase. Ele implementará `ChatGenerationPort` e poderá ser substituído futuramente por um cliente HTTP sem alteração do contrato público do frontend.

```text
HTTP route
  -> ChatService
      -> ChatHistoryPort (Redis)
      -> ChatPromptBuilder
      -> ChatGenerationPort
          -> OpenRouterChatGateway
```

O Redis será consultado a cada nova mensagem. O caso de uso lerá o histórico antes da chamada de IA, anexará a nova mensagem do aluno antes da geração e gravará a resposta final somente depois de uma geração bem-sucedida.

## Contrato de geração

```ts
type ChatGenerationInput = {
  message: string;
  history: ChatHistoryMessage[];
  questionContext: AuthorizedQuestionContext | null;
  monitorId: string;
  subjectId: string;
};

interface ChatGenerationPort {
  generate(input: ChatGenerationInput): Promise<{ content: string }>;
}
```

O gateway receberá dados já autorizados. Ele não autoriza aluno, monitor, matéria ou questão e não acessa Redis diretamente.

## Prompt e contexto

O `ChatPromptBuilder` produzirá mensagens compatíveis com o OpenRouter:

- uma mensagem `system` com o papel pedagógico, limites de segurança e instrução para não inventar dados da questão;
- mensagens do histórico convertidas de `student`/`assistant` para `user`/`assistant`;
- a nova mensagem do aluno como a última mensagem `user`;
- o contexto autorizado da questão incluído como conteúdo delimitado, nunca como instrução de sistema.

O prompt não incluirá credenciais, tokens, `studentId` ou dados internos de autorização. O contexto enviado pelo frontend será considerado apenas complemento de apresentação; os identificadores e o escopo já terão sido comparados com a questão oficial antes da geração.

## OpenRouter

O adapter reutilizará o `OpenRouterClient` existente através de um método de completion textual não estruturada, ou de uma pequena extensão isolada desse cliente. A resposta deverá:

- usar modelo configurável por `CHAT_AI_MODEL`, com fallback para `OPENROUTER_QUESTION_MODEL`;
- usar `CHAT_AI_MAX_TOKENS`, `CHAT_AI_TEMPERATURE` e `CHAT_AI_TIMEOUT_MS`;
- rejeitar chave ausente, erro HTTP, timeout e resposta vazia com erros estáveis do domínio;
- nunca devolver ao frontend a chave, prompt interno ou corpo bruto de erro do provedor;
- registrar apenas metadados operacionais: request id, modelo, duração, tamanho de entrada/saída e status.

## Persistência do fluxo

Escopo Redis: `studentId + monitorId + subjectId`.

Fluxo aprovado:

1. autenticar e autorizar o aluno;
2. validar o contexto oficial da questão;
3. ler até 40 mensagens do Redis;
4. anexar a mensagem do aluno e renovar o TTL;
5. chamar o gateway com histórico anterior, mensagem atual e contexto autorizado;
6. anexar a resposta final da IA e renovar o TTL;
7. retornar a resposta ao frontend.

Se a IA falhar, a mensagem do aluno permanece no Redis e nenhuma resposta assistente é criada. A API retorna erro controlado `CHAT_GENERATION_FAILED`.

## Limites V1

- histórico máximo: 40 mensagens;
- mensagem do aluno: 4.000 caracteres;
- resposta máxima: configurável por tokens;
- timeout padrão: 30 segundos;
- sem streaming SSE nesta etapa;
- sem RAG de chunks nesta etapa; o contexto da questão e o histórico são as únicas fontes enviadas ao modelo.

## Testes obrigatórios

- o builder converte histórico e contexto em mensagens na ordem correta;
- o gateway envia modelo, temperatura, limite e timeout configurados;
- resposta textual válida é normalizada;
- resposta vazia e erro do provedor viram erro de geração estável;
- `ChatService` consulta Redis em cada mensagem;
- mensagem do aluno é salva antes da geração;
- resposta assistente só é salva após sucesso;
- falha da IA não cria resposta assistente;
- a rota retorna a resposta e não retorna mais `501` em caso de sucesso.

## Fora do escopo

- streaming SSE;
- busca vetorial/RAG em documentos;
- persistência permanente no PostgreSQL;
- resumo automático da conversa;
- criação de um deploy separado para o chat.
