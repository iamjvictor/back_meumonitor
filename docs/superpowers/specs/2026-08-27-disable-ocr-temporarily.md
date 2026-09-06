# Spec: desativar OCR temporariamente

## Objetivo

Reduzir CPU, memória e tempo de processamento desativando OCR para todos os
PDFs durante a fase atual do pipeline.

## Comportamento

- O parser sempre usa `do_ocr=False` por padrão.
- O parser sempre usa `force_backend_text=True` quando OCR está desativado.
- A análise da camada textual continua sendo executada e reportada em
  `textAnalysis`, mas não pode reativar OCR automaticamente.
- A decisão é reversível por uma opção explícita no parser, sem alterar o
  contrato HTTP.
- PDFs apenas escaneados podem retornar pouco ou nenhum texto; isso é uma
  consequência aceita nesta fase.

## Testes

- Verificar que TEXT, MIXED e SCANNED passam ao converter com OCR desativado.
- Verificar que a análise continua aparecendo na resposta.
- Verificar que a fábrica do Docling cria opções sem OCR.
- Preservar os testes e contratos existentes.

## Fora do escopo

- Não alterar schema, worker, timeout ou fluxo de persistência.
- Não remover o preflight nem a classificação da camada textual.
