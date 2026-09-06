# Herdar tópico do documento para chunks

## Objetivo

Garantir que chunks criados para um documento recebam os tópicos informados no upload quando seus blocos ainda não possuem classificação própria.

## Comportamento

- `saveExtractedChunks` deve carregar os tópicos vinculados ao documento.
- Para cada chunk, usar os tópicos classificados do bloco quando existirem.
- Quando o bloco não tiver tópicos classificados, usar os tópicos do documento como fallback.
- Persistir os vínculos em `document_chunk_topics` na mesma transação dos chunks.
- Não alterar o filtro de elegibilidade nem o prompt do gerador de flashcards.
- Não chamar uma nova IA para classificação neste ajuste.
- Manter `topicCount` e `topicLinkCount` refletindo os vínculos efetivamente criados.

## Critérios de aceite

- Documento com tópico e bloco sem classificação produz chunk com esse tópico.
- Bloco com classificação própria continua tendo prioridade sobre o tópico do documento.
- Documento sem tópico e bloco sem classificação continua produzindo chunk sem vínculo.
- O teste deve falhar antes da implementação e passar depois.
