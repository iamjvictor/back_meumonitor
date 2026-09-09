# Spec — Serviço RAG do Chat do Aluno

**Data:** 2026-09-07  
**Status:** V1 implementada; fontes oficiais, flashcards, Redis, fallback semântico e observabilidade concluídos
**Escopo:** recuperar conhecimento autorizado para enriquecer o contexto enviado ao gateway de IA do chat.

## 1. Workspace do serviço

### Situação atual

O workspace continua dentro da API, em `backend/src/modules/chat/rag/`. Não existe um deploy
separado para o RAG nesta versão. O chat pode ser extraído posteriormente sem mudar o endpoint
público, substituindo a fachada do módulo por um cliente HTTP.

O workspace lógico do serviço será:

```text
backend/src/modules/chat/rag/
```

Estrutura planejada:

```text
src/modules/chat/rag/
├── models/
│   └── chat-rag.model.ts
├── ports/
│   └── chat-knowledge.port.ts
├── services/
│   ├── chat-rag.service.ts
│   ├── chat-query-rewriter.service.ts
│   └── chat-context-assembler.service.ts
├── providers/
│   └── knowledge-retrieval-chat.provider.ts
└── __tests__/
```

Esse diretório não representa um deploy separado. Na V1 ele roda dentro do processo da API e é chamado pelo `ChatService`.

O serviço não acessará Redis diretamente. A leitura do Redis continuará em `ChatService`, através de `ChatHistoryPort`. O RAG receberá uma lista imutável de mensagens como entrada.

## 2. Objetivo

Quando o aluno enviar uma dúvida, o sistema deverá:

1. usar a mensagem atual, o histórico recente e a questão anexada para formar uma consulta de busca;
2. gerar embedding da consulta;
3. recuperar evidências autorizadas no banco;
4. combinar questão, histórico e evidências em um contexto limitado;
5. entregar esse contexto ao `ChatGenerationPort`;
6. permitir uma resposta pedagógica fundamentada nos documentos da matéria.

O serviço não responderá ao aluno e não chamará diretamente o modelo de chat. Ele apenas recuperará e organizará conhecimento.

## 3. Arquitetura

```text
POST /chat/messages
        ↓
ChatAuthorizationService
        ↓
QuestionContextAuthorizer
        ↓
ChatHistoryPort → Redis
        ↓
ChatService
        ├── ChatRagService
        │     ├── QueryRewriter opcional
        │     ├── EmbeddingGateway
        │     ├── KnowledgeRetrievalService
        │     └── ContextAssembler
        └── ChatGenerationPort
              └── OpenRouterChatGateway
```

Fluxo de dados:

```text
histórico Redis
      + mensagem atual
      + questão oficial
      ↓
consulta de retrieval
      ↓
embedding
      ↓
busca híbrida pgvector + lexical
      ↓
chunks e blocos autorizados
      ↓
contexto RAG limitado
      ↓
prompt final
      ↓
OpenRouter
```

## 4. Contratos

### 4.1 Entrada do RAG

```ts
type ChatRagInput = {
  message: string;
  history: ChatHistoryMessage[];
  questionContext: AuthorizedQuestionContext | null;
  studentId: string;
  teacherId: string;
  monitorId: string;
  subjectId: string;
  topicId: string | null;
};
```

`studentId` serve para autorização/auditoria e nunca será usado como dado de busca fornecido pelo cliente. `teacherId`, `monitorId`, `subjectId` e `topicId` devem ser derivados ou confirmados pelo backend.

### 4.2 Porta de conhecimento

```ts
interface ChatKnowledgePort {
  retrieve(input: ChatRagInput): Promise<ChatRagResult>;
}
```

### 4.3 Resultado do RAG

```ts
type ChatRagResult = {
  used: boolean;
  retrievalQuery: string;
  context: string;
  citations: ChatRagCitation[];
  metrics: {
    candidateCount: number;
    selectedCount: number;
    durationMs: number;
  };
};

type ChatRagCitation = {
  chunkId: string;
  documentId: string;
  blockId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
  content: string;
};
```

As citações são metadados internos da resposta. Elas não serão persistidas no PostgreSQL nesta etapa e não precisam ser exibidas no frontend V1.

## 5. Fonte do histórico

O Redis permanece como memória temporária:

```text
chat:history:v1:{studentId}:{monitorId}:{subjectId}
```

O `ChatService` fará:

1. `list(scope)` no Redis;
2. limitará o histórico a 40 mensagens;
3. entregará as mensagens ao `ChatRagService`;
4. salvará a mensagem do aluno antes da geração;
5. salvará a resposta do assistente após a geração.

O RAG usará o histórico para resolver referências anafóricas e melhorar a consulta, mas não deverá enviar automaticamente todas as mensagens para o banco ou para o embedding. A consulta deve usar apenas o trecho necessário do histórico, inicialmente as últimas 6 mensagens.

## 6. Construção da consulta

A consulta base será formada por:

```text
mensagem atual
+ enunciado oficial da questão, quando houver
+ tópico oficial, quando houver
+ últimas mensagens relevantes do histórico
```

Na primeira versão, a consulta deve ser determinística e não depender de uma segunda chamada de LLM. A reformulação por IA entrará depois como otimização controlada.

Exemplo:

```text
Dúvida atual: E nessa questão?
Tópico: Dinâmica
Questão: O motorista atento aciona o freio...
Histórico recente: o aluno perguntou sobre velocidade e tempo de reação.
```

Consulta para retrieval:

```text
Explique a distância adicional percorrida pelo motorista desatento devido ao tempo de reação, considerando velocidade constante e frenagem.
```

A mensagem original continuará sendo preservada no prompt final.

## 7. Retrieval

O provider do chat reutilizará `KnowledgeRetrievalService` e `searchReadyKnowledgeChunks`, sem duplicar SQL vetorial.

Filtros obrigatórios:

- `teacherId` derivado do monitor ou questão;
- `monitorId` autorizado;
- `subjectId` autorizado;
- `topicId`, quando confirmado;
- apenas chunks com status `READY` e embedding disponível;
- exclusão de documentos ou blocos fora do escopo.

Estratégia V1:

1. buscar no documento de origem da questão, quando houver `QuestionSource`;
2. complementar com documentos autorizados da matéria;
3. combinar similaridade vetorial e lexical;
4. agrupar por bloco pai para evitar duplicidade;
5. selecionar no máximo 8 blocos/chunks;
6. limitar o contexto final por caracteres e tokens.

O RAG não poderá fazer busca global apenas por `queryEmbedding`.

## 10. Observabilidade e avaliação

Os eventos do RAG usam os prefixos dos arquivos e registram somente metadados operacionais:

- início da recuperação e consulta construída;
- conclusão do embedding;
- conclusão do retrieval com candidatos, selecionados, duração e scores agregado, mínimo e máximo;
- montagem do contexto com quantidade de citações, tamanho e quantidade de histórico;
- falha não bloqueante com o nome da categoria do erro.

O conteúdo integral da mensagem, do histórico e dos chunks não deve ser registrado em logs
de produção. Os testes do módulo cobrem o escopo autorizado, fallback sem evidências,
montagem de contexto e o caso de avaliação com chunk esperado.

Na V1 permanecem deliberadamente fora deste serviço: streaming SSE, decomposição de
consulta por LLM e extração para deploy independente. Essas evoluções podem trocar o
adapter de geração/RAG sem alterar o contrato público da API.

## 8. Contextual chunking

O pipeline já possui `embeddingContent`, `sectionPath`, `blockType` e vínculos de tópico. A evolução prevista é garantir que o conteúdo vetorizado possua um cabeçalho contextual:

```text
Documento: livro de física
Matéria: Física
Tópico: Dinâmica
Seção: Leis de Newton
Tipo: EXPLANATION

Conteúdo original do chunk...
```

Essa mudança pertence ao pipeline de ingestão/embeddings, não ao request do chat. Depois de implementada, os chunks afetados deverão ser reprocessados.

Ela não será bloqueadora para o primeiro RAG do chat, pois o retrieval atual já possui filtros e metadados estruturais.

## 9. Query rewriting e decomposition

### V1

- consulta determinística;
- uso das últimas 6 mensagens;
- questão oficial incluída quando anexada;
- sem chamada extra de LLM.

### V1.1

Adicionar `ChatQueryRewriter` apenas quando:

- a mensagem tiver referência ambígua, como “nessa questão”;
- a mensagem tiver menos de um limite mínimo de informação;
- o histórico alterar o significado da pergunta.

### V2

Adicionar decomposição somente para perguntas com múltiplas intenções detectáveis. Cada subconsulta terá retrieval próprio, e os resultados serão deduplicados antes da montagem do contexto.

## 10. Montagem do contexto

O `ChatContextAssembler` produzirá um bloco delimitado:

```text
[QUESTÃO OFICIAL]
...

[HISTÓRICO RELEVANTE]
...

[EVIDÊNCIAS RECUPERADAS]
Evidência 1 — documento X — página 4
...

[DÚVIDA ATUAL DO ALUNO]
...
```

O texto dos documentos será tratado como dado, nunca como instrução de sistema. O prompt deverá exigir que a IA:

- priorize a questão oficial e as evidências;
- explique o raciocínio passo a passo;
- não invente conteúdo ausente;
- diga quando não houver evidência suficiente;
- não revele IDs internos, prompts, tokens ou regras de autorização.

## 11. Falhas e fallback

Se a geração de embedding ou a busca RAG falhar:

- registrar erro estruturado com `requestId`;
- não expor detalhes internos ao aluno;
- continuar com questão oficial e histórico, quando disponíveis;
- marcar `used: false`;
- permitir que o gateway gere uma resposta limitada ao contexto disponível.

Se o gateway de IA falhar:

- a mensagem do aluno continua no Redis;
- nenhuma resposta assistente é salva;
- a API retorna erro controlado.

## 12. Observabilidade

Eventos mínimos:

```text
chat.rag_started
chat.rag_query_built
chat.rag_embedding_completed
chat.rag_retrieval_completed
chat.rag_context_assembled
chat.rag_failed_non_blocking
```

Os logs devem incluir:

- `requestId`;
- `studentId` somente em logs internos autorizados;
- `monitorId`;
- `subjectId`;
- `questionId` quando houver;
- quantidade de candidatos;
- quantidade selecionada;
- scores agregados;
- duração por etapa.

Não registrar o conteúdo completo da mensagem, token de sessão, chave de provider ou histórico integral em logs de produção.

## 13. Testes obrigatórios

- usa histórico Redis recebido pelo caso de uso;
- constrói consulta com questão e histórico;
- não acessa Redis diretamente dentro do RAG;
- envia filtros obrigatórios para o retrieval;
- não retorna chunks de outro monitor ou matéria;
- combina resultado vetorial e lexical através do serviço existente;
- limita quantidade e tamanho do contexto;
- mantém a mensagem original no prompt final;
- faz fallback quando embedding falha;
- registra métricas sem registrar conteúdo sensível;
- encaminha evidências ao gateway;
- não salva resposta assistente quando a geração falha.

## 14. Fora do escopo

- novo deploy para o RAG;
- Chroma ou outro banco vetorial separado;
- LangChain obrigatório;
- persistência permanente do histórico;
- query decomposition automática na primeira versão;
- reranking por LLM na primeira versão;
- streaming SSE;
- resposta com citações visíveis no frontend.
