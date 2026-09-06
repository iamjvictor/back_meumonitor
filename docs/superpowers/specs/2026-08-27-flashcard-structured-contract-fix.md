# Contrato estruturado de geração de flashcards

## Problema

O envelope retornado pelo modelo (`eligible`, `reason`, `flashcards`) foi aceito,
mas os itens de `flashcards` usavam `items: {}` no JSON Schema e o prompt não
descrevia os campos exigidos pelo backend. Como consequência, a IA podia
retornar cards semanticamente úteis, porém incompatíveis com o `candidateSchema`;
os 10 cards gerados no último upload foram rejeitados e nenhum foi persistido.

## Objetivo

Fazer o agente retornar cards diretamente compatíveis com o contrato interno:

```json
{
  "eligible": true,
  "reason": "CONCEPTUAL_CONTENT",
  "flashcards": [
    {
      "front": "O que é um triângulo?",
      "back": "Um polígono formado por três segmentos de reta.",
      "evidence": ["Um triângulo é um polígono formado por três segmentos de reta."],
      "kind": "DEFINITION",
      "difficulty": "EASY",
      "topicId": "<um dos allowedTopicIds>"
    }
  ]
}
```

## Regras

- O JSON Schema deve descrever cada propriedade do item, sem `items: {}`.
- Os nomes devem ser exatamente `front`, `back`, `evidence`, `kind`, `difficulty`
  e `topicId`.
- `evidence` é um array com pelo menos uma citação literal do chunk.
- `kind` aceita somente `DEFINITION`, `FORMULA`, `RULE`, `EXCEPTION` ou `APPLICATION`.
- `difficulty` aceita `EASY`, `MEDIUM`, `HARD` ou `null`.
- `topicId` deve ser copiado exatamente de `allowedTopicIds`.
- `eligible=false` exige `flashcards=[]`.
- Cards válidos continuam sujeitos à validação determinística e são salvos como
  `PENDING_REVIEW` com `flashcard_sources`.

## Prompt

O prompt deve declarar o contrato dos campos, os valores enumerados, que a
evidência deve ser literal e que nenhum conhecimento externo pode ser usado.

## Testes

- Testar que o schema enviado possui propriedades internas completas e required.
- Testar que uma resposta com os seis campos é aceita e persistida.
- Testar que `sourceQuote`/`type` ou item sem `topicId` não é tratado como card válido.
- Executar a suíte de flashcards e o typecheck.
