# Qualidade do pipeline de questões — Design

## Objetivo

Processar documentos de questões sem perder candidatas recuperáveis, preservando rastreabilidade e completando com IA campos ausentes quando houver contexto suficiente.

## Regras

- Layout Docling inválido em um elemento deve degradar apenas esse elemento, não o documento inteiro.
- Continuações, alternativas ausentes e enunciados incompletos com evidência devem ser promovidos para reconstrução por IA.
- Gabarito e explicação devem ser gerados e validados independentemente.
- Falha de tópico deve aplicar fallback válido.
- Classificação não bloqueante não deve impedir extração nem criar `PARTIAL_SUCCESS` indevido.
- `REVIEW_REQUIRED`/`PENDING_REVIEW` é revisão humana normal.
- Não apagar fontes nem o documento original.

## Aceite

- Questões recuperáveis chegam aos agentes de conclusão.
- Questões completas não possuem gabarito ou explicação vazios.
- Nenhuma questão fica sem tópico quando há fallback válido.
- O pipeline registra contagens agregadas e motivos de retenção.

