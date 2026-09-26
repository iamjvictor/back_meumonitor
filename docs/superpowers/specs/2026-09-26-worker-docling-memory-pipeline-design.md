# Pipeline Docling com uso controlado de memória

## Objetivo

Usar o `LayoutDocument` já produzido pelo Docling como fonte textual do pipeline, eliminando a segunda leitura integral por PDF.js no modo Docling e preservando qualidade, páginas, fórmulas, tabelas e evidência visual.

Esta especificação cobre `WM-03`, `WM-04` e a parte de carregamento de PDF.js de `WM-06`. Não remove dependências da imagem Docker.

## Arquitetura

```text
PDF bytes → Docling → LayoutDocument normalizado → persistência de layout
                                      ↓
                         projeção pura ParsedPdfText
                                      ↓
           qualidade → normalização → blocos → chunks → embeddings
```

No modo Docling, `extractPdfPagesWithLayout` não pode ser importado nem chamado. No modo legado, PDF.js permanece disponível durante a implantação gradual.

## Configuração

```ts
DOCUMENT_TEXT_SOURCE: z.enum(['pdfjs', 'docling']).default('pdfjs')
```

Regras:

- `docling` exige `DOCUMENT_INGESTION_V3_ENABLED=true` e `DOCUMENT_PARSER_BASE_URL`;
- configuração incompatível falha no boot;
- `pdfjs` mantém o caminho atual como rollback explícito;
- falha ou `FALLBACK_REQUIRED` do Docling nunca aciona PDF.js implicitamente.

## Contrato de projeção

Criar `layout-text-projection.service.ts`:

```ts
export type DocumentTextSourceMetadata = {
  parser: DocumentParserName;
  parserVersion: string;
  parseRunId: string;
  schemaVersion: string;
  backend?: string;
  modelVersion?: string;
  warnings: string[];
  formulaCount: number;
  tableCount: number;
};

export function projectLayoutDocumentToParsedPdfText(
  layout: LayoutDocument,
): ParsedPdfText & { source: DocumentTextSourceMetadata };
```

Regras estruturais:

- ordenar páginas por `pageNumber` crescente;
- preservar páginas vazias e numeração 1-based já normalizada;
- ordenar elementos por `readingOrder`, usando posição original como desempate estável;
- separar elementos por `\n` e páginas por `\n\n`;
- `total` é exatamente `layout.pages.length`;
- não mutar layout, páginas, elementos, assets ou warnings.

### Seleção de texto

Para texto comum: `normalizedText` não vazio, depois `rawText` não vazio, depois HTML convertido de forma determinística. Elementos sem representação textual não geram placeholder.

`TITLE`, `TEXT`, `LIST`, `CAPTION`, `HEADER`, `FOOTER`, `PAGE_NUMBER`, `FOOTNOTE` e `UNKNOWN` participam. A remoção de cabeçalhos e rodapés continua em `TextNormalizationService`.

### Fórmulas

- preservar texto humano disponível;
- anexar `latex` somente se ainda não estiver representado;
- se houver apenas LaTeX, usar LaTeX;
- não reparar, interpretar ou descartar fórmula na projeção.

### Tabelas

- priorizar `normalizedText`, depois `rawText`;
- quando houver somente HTML: `tr`, `p` e `br` viram quebras; células usam ` | `; tags são removidas e entidades decodificadas;
- não persistir HTML bruto como texto;
- tabela apenas visual não recebe texto artificial.

### Figuras e evidência visual

- incluir caption/texto existente;
- não inserir `[FIGURE]`, `[IMAGE]` ou marcador semelhante;
- `imageCount` conta IDs únicos de assets `FIGURE` ou `CROP` associados à página;
- múltiplas referências ao mesmo asset contam uma vez;
- figura sem asset, mas representada por elemento `FIGURE`, conta uma vez;
- `TABLE` e `FORMULA` não contam automaticamente como imagem;
- página apenas com figura fica com `text=''`, `hasImages=true`.

Página realmente vazia:

```ts
{ num: pageNumber, text: '', hasImages: false, imageCount: 0 }
```

## Resultado da ingestão V3

Ampliar `DocumentIngestionV3Result`:

```ts
export type DocumentIngestionV3Result = {
  // campos existentes
  parsedPdf?: ParsedPdfText & { source: DocumentTextSourceMetadata };
};
```

Após validar e persistir o layout, `processDocument` projeta e retorna `parsedPdf`. Não retorna o layout inteiro além do escopo necessário. Resultado `COMPLETED` sem projeção gera `DOCLING_LAYOUT_PROJECTION_MISSING`.

O worker seleciona:

- `DOCUMENT_TEXT_SOURCE=docling`: exige `v3Result.parsedPdf`;
- `DOCUMENT_TEXT_SOURCE=pdfjs`: chama o extrator legado;
- Docling falhou: marca documento como falho e relança, independentemente da flag de rollback.

## Procedência e qualidade

`DocumentTextExtractionService.process` recebe metadados de origem junto ao `ParsedPdfText`. No modo Docling, `qualityDetails` registra:

- `parser: 'docling-layout-projection'`;
- parser name/version, parseRunId e schema;
- `extractionMethod: 'layout-document-elements'`;
- páginas com imagens, imageCount, formulaCount, tableCount e warning count.

Os limiares permanecem:

- nenhum texto → `FAILED`;
- todas as páginas vazias → `NEEDS_OCR`;
- menos de 80 caracteres por página e presença de página vazia → `NEEDS_OCR`;
- caracteres `U+FFFD` acima de 0,5% ou algumas páginas vazias → `PARTIAL`;
- demais casos → `GOOD`.

Warnings de layout não rebaixam texto bom automaticamente.

## Cleanup e cópias do PDF

Enquanto o modo legado existir:

- destruir documento/loading task em `finally`;
- executar cleanup por página após leitura;
- cleanup ocorre em sucesso, falha na abertura, falha textual e falha na lista de operadores;
- preservar nome, MIME, SHA-256 e bytes do multipart em retry;
- evitar `Buffer.from(fileBytes)` quando Blob aceitar o `Uint8Array` sem conversão adicional;
- não afirmar streaming: o arquivo ainda é materializado integralmente.

## Carregamento sob demanda

O módulo PDF.js é importado exclusivamente dentro do caminho legado. O serviço de documento pode ser inicializado por loader compartilhado:

```ts
export type DocumentWorkerServiceLoader = () => Promise<DocumentWorkerService>;
```

Chamadas concorrentes aguardam uma única Promise; falha de inicialização limpa a Promise para permitir retry. O carregamento lazy não deve alterar resultado de chunking/tokenização.

## TDD obrigatório

### Projeção pura

Criar testes para ordem, desempate, páginas fora de ordem, página vazia, somente imagem, normalized/raw/html, fórmula com e sem texto, tabela textual/HTML, deduplicação de assets, separadores e não mutação.

### Integração

- ingestão inline projeta sem `GET /result`;
- resultado remoto projeta após persistência;
- modo Docling faz zero chamadas ao extrator PDF.js;
- `FALLBACK_REQUIRED` não usa PDF.js;
- modo legado continua funcional;
- estados `GOOD`, `PARTIAL`, `NEEDS_OCR` e `FAILED` permanecem equivalentes;
- fixture com duas colunas, fórmula, tabela, figura e página vazia atravessa projeção, texto, blocos e chunks sem duplicação.

### Cleanup

Com adapter PDF.js injetável/fake, testar cleanup em todos os caminhos e retry multipart com bytes completos.

## Critérios de aceite

- modo Docling não importa nem executa PDF.js;
- nenhuma página ou evidência visual necessária é perdida;
- `LayoutDocument` não é mutado;
- nenhuma representação é concatenada duas vezes;
- rollback para `pdfjs` é explícito por configuração;
- falhas Docling continuam bloqueantes;
- corpus funcional e contratos do parser passam antes da ativação.

