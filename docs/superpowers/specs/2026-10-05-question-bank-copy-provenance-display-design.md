# Rastreabilidade e identificação de questões copiadas do acervo

**Status:** proposta aprovada para documentação; aguarda revisão da spec  
**Data:** 2026-10-05

## Objetivo

Quando um professor copia questões do acervo para um monitor, a questão do monitor deve manter rastreabilidade até o item original. Na prática do aluno, imagens, identificação da banca/prova e ano devem chegar junto com a questão. O cabeçalho/título visível deve apresentar a banca (ou nome da prova quando não houver banca) e o ano quando disponível.

Exemplos de identificação:

- `ENEM • 2008` quando a banca não se aplica e o nome da prova é ENEM;
- `CESGRANRIO • 2023` quando a banca está disponível;
- omitir o ano se a fonte não tiver ano, sem exibir separadores soltos.

## Contexto atual

- `QuestionBankItem` armazena `imageUrls`, `examName`, `board`, `institution` e `examYear`.
- `Question` aponta opcionalmente para `QuestionBankItem` por `questionBankItemId`; a relação usa `onDelete: Restrict`.
- A materialização cria/atualiza uma questão por monitor e item de acervo, salva a origem em `sourceKey`, mantém a FK e grava metadados de origem em `Question.metadata`.
- A consulta de prática do aluno seleciona atualmente `questionBankItem.imageUrls`; não seleciona os dados da prova nem usa o snapshot de `metadata` como fallback.
- A tela já tenta renderizar `imageUrls`, mas não tem campos de banca/prova/ano e seu cabeçalho atual mostra posição e tópico.

## Decisões de desenho

1. Manter o modelo atual de cópia materializada: uma linha `Question` por monitor, relacionada ao item original do acervo. Não duplicar os arquivos de imagem nem adicionar uma nova tabela de proveniência.
2. Preservar no snapshot `Question.metadata` os campos já gravados: identificadores do provedor, banca, nome da prova, instituição, ano, URL de origem e URLs de imagem. Os testes da materialização devem provar estes valores e a FK/source key.
3. Na consulta de prática, expor um bloco explícito de proveniência e `imageUrls`, obtidos preferencialmente do `QuestionBankItem` relacionado. Para cópias antigas ou relações sem valores utilizáveis, recorrer aos mesmos campos do snapshot em `Question.metadata`.
4. No cabeçalho da questão do aluno, mostrar posição, tópico e identificação da origem. Usar `board` quando preenchida; na falta dela, usar `examName`. Mostrar `examYear` quando numérico/disponível. O ano não deve ser inferido de texto livre.
5. Questões que não vieram do acervo continuam válidas: não mostram imagem nem identificação de prova se esses dados não existirem.
6. Não alterar o fluxo de resposta, gabarito, autorização, classificação ou seleção de questões.

## Contrato esperado na prática

Cada questão retornada pela API de prática deve manter os campos atuais e, quando originada do acervo, incluir dados equivalentes a:

```ts
{
  imageUrls: string[];
  provenance: {
    board: string | null;
    examName: string | null;
    examYear: number | null;
    sourceUrl: string | null;
  } | null;
}
```

URLs devem ser normalizadas como lista de strings não vazias. A UI monta um rótulo curto com `board ?? examName` e o ano disponível. A origem pode vir da relação ou, como fallback, do snapshot. `provenance` é `null` para questões sem dados de origem do acervo.

## Requisitos funcionais

- **RF1:** materializar uma questão do acervo conserva `questionBankItemId`, `sourceKey` determinística por monitor/item e snapshot dos metadados relevantes, inclusive imagens, banca, nome da prova e ano.
- **RF2:** repetir a materialização atualiza a mesma cópia e mantém a rastreabilidade; copiar o mesmo item para outro monitor cria uma cópia distinta ligada ao mesmo original.
- **RF3:** o endpoint de questões de prática devolve imagens e proveniência disponíveis, com fallback do snapshot para dados que não estejam disponíveis na relação.
- **RF4:** a tela do aluno renderiza as imagens existentes e inclui banca (ou nome de prova substituto) e ano no cabeçalho de cada questão.
- **RF5:** ausência de imagem, banca/prova ou ano não quebra a resposta nem produz rótulos vazios; campos ausentes são omitidos.
- **RF6:** questões próprias ou antigas sem ligação ao acervo preservam o comportamento atual.

## Requisitos não funcionais

- Nenhuma migração de banco é esperada; validar o schema e os dados existentes antes de propor alteração estrutural.
- Não baixar nem copiar imagens. Exibir as URLs já armazenadas.
- Não vazar gabarito ou explicação antes do fluxo atual de submissão.
- Manter compatibilidade do formato de alternativas e dos filtros/paginação do endpoint.

## Estratégia de testes TDD

Os testes precedem cada alteração de produção. Para cada comportamento, executar o teste novo e confirmar falha pela ausência/erro do comportamento esperado, implementar a menor mudança e executar novamente até passar.

1. **Materialização:** estender os testes do serviço para exigir FK, source key e snapshot com URL de imagem, banca, nome de prova e ano; testar retry e cópia em monitor distinto.
2. **Contrato de consulta/API:** testar seleção e normalização de imagens/proveniência da relação e fallback por snapshot; cobrir metadados nulos, array vazio e questão sem `QuestionBankItem`.
3. **Cabeçalho do aluno:** teste de contrato/componente deve confirmar que o cabeçalho combina tema com banca e ano, usa nome da prova quando banca é nula e omite partes indisponíveis.
4. **Regressão de imagem:** confirmar que URLs da origem chegam a `OptimizedImage` e que zero URLs não renderiza um contêiner de imagem vazio.

Testes direcionados esperados: teste Node do serviço de materialização; testes Node do repositório/serviço de prática; testes existentes de contrato frontend e, se houver componente extraído, teste do componente. Rodar os comandos concretos será especificado no plano de implementação.

## Critérios de aceite

- Uma questão ENEM 2008 materializada mantém FK/source key e snapshot com as imagens e ano 2008.
- A prática entrega as URLs e exibe a imagem, com cabeçalho contendo `ENEM` e `2008`.
- Uma questão de concurso com banca preenchida exibe banca e ano, mesmo se `examName` for diferente.
- Quando a banca for nula, o nome da prova identifica a questão; quando o ano for nulo, só a identificação da prova/banca aparece.
- Se a relação não fornecer imagens/metadados, os valores úteis do snapshot são usados; se ambos estiverem vazios, a questão continua exibida sem imagem ou rótulo quebrado.
- Questões fora do acervo continuam funcionando sem alteração no fluxo de resposta.

## Fora de escopo

- Corrigir ou reimportar imagens ausentes/inválidas na fonte externa.
- Fazer proxy, cache, espelhamento ou transformação de imagens.
- Exibir instituição, URL da fonte ou ID externo no cabeçalho; ficam disponíveis para rastreabilidade no contrato/dados, mas não são necessários no título solicitado.
- Alterar telas do professor ou filtros de seleção do acervo.
