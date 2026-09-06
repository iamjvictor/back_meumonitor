# OCR adaptativo para o parser Docling

## Objetivo

Evitar o custo elevado de OCR em PDFs que já possuem camada de texto nativa,
sem perder suporte a PDFs escaneados ou mistos.

## Comportamento

Antes de criar o `DocumentConverter`, o serviço deve executar uma pré-análise
rápida e determinística do PDF:

- contar caracteres extraíveis por página;
- calcular a proporção de páginas com camada textual útil;
- classificar o arquivo como `TEXT`, `SCANNED` ou `MIXED`.

Para PDFs `TEXT`, o Docling deve ser configurado com:

```python
PdfPipelineOptions(do_ocr=False, force_backend_text=True)
```

Para PDFs `SCANNED` ou `MIXED`, o comportamento atual com OCR deve ser mantido.
O detector não deve carregar modelos de OCR.

## Critérios determinísticos iniciais

- página textual útil: pelo menos 80 caracteres normalizados;
- `TEXT`: pelo menos 70% das páginas são textuais úteis;
- `SCANNED`: menos de 30% das páginas são textuais úteis;
- `MIXED`: qualquer proporção intermediária.

Os limites devem ser constantes nomeadas e testáveis. Um PDF vazio, inválido ou
sem páginas deve seguir para o caminho `SCANNED`, permitindo que a camada de
erro do Docling decida o resultado final.

## Contrato de observabilidade

Antes da conversão, emitir evento contendo:

```text
docling_parser.text_layer_analyzed
classification
page_count
pages_with_text
native_text_chars
ocr_enabled
force_backend_text
```

## Duplicidade de conversão

O serviço HTTP não deve executar simultaneamente duas conversões para o mesmo
SHA-256. Requisições concorrentes do mesmo arquivo devem compartilhar o
resultado em andamento ou aguardar a primeira conversão terminar. O cache de
resultados concluídos deve continuar funcionando.

## Compatibilidade

- Preservar o contrato HTTP existente (`POST /v1/parse` e `GET /health`).
- Preservar `markdown`, `document` e `layout` na resposta.
- Adicionar `textAnalysis` ao resultado apenas como metadado não obrigatório.
- Não alterar o contrato do worker, chunks ou flashcards.
- Declarar a dependência usada para pré-análise explicitamente no projeto.

## Critérios de aceite

- PDF textual não inicializa OCR e usa `force_backend_text=True`.
- PDF escaneado mantém OCR habilitado.
- PDF misto mantém OCR habilitado para não degradar a qualidade.
- A decisão é registrada nos logs.
- Dois pedidos simultâneos do mesmo hash não executam duas conversões.
- Testes unitários cobrem as três classificações, PDF sem texto e deduplicação.
- Testes existentes do parser continuam passando.
