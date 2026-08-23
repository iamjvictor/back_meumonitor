# Question Processing Backlog

## Current Result

- Latest run persisted 68 complete questions.
- Questions whose completion agents failed are currently not persisted.
- Some persisted questions still have `topicId = null`.
- The document is allowed to finish even when a question group or a completion agent fails.

## Recent Errors

### Explanation agent output truncation

Observed log:

```text
task: question_explanation
model: deepseek/deepseek-v4-flash-0731
completionTokens: 900
responseChars: 0
finishReason: length
code: MODEL_OUTPUT_TRUNCATED
```

The provider consumed the entire output budget and returned no usable structured content. The same request was retried three times with the same model and conditions, so all attempts failed. `QuestionCompletionService` then returned `null`, and `QuestionExtractionService` skipped the candidate.

Important inconsistency: the expected `QUESTION_EXPLANATION_MAX_TOKENS` value is 350, but this worker logged 900 completion tokens. Before changing prompts or models, verify the effective runtime configuration. Possible causes are a worker that was not restarted, an environment override, or an older worker build still consuming jobs.

### Question extraction output truncation

Observed log:

```text
schemaName: question_extraction
model: deepseek/deepseek-v4-flash-0731
completionTokens: 2048
finishReason: length
```

This is separate from the completion agents. It happens while `QuestionExtractionService` extracts candidates from groups of chunks. It previously used the OpenRouter default of 2048 tokens. The code now passes `DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS`, currently configured as 4000, but a worker restart is required.

### Invalid source indexes in extraction output

Observed validation failure:

```text
answerSourceChunkIndexes: expected array, received null
explanationSourceChunkIndexes: expected array, received null
```

The extraction model uses `null` when there is no answer/explanation source. The local Zod schema requires arrays. This rejects an otherwise usable group and retries it. The semantic empty value should be `[]`.

### Questions without a primary topic

Question category assignment is non-blocking. A question can remain with `topicId = null` when the extracted candidate has no valid topic and `QuestionCategoryAgentService` cannot return a valid allowed `primaryTopicId`. Current logs do not distinguish these causes clearly enough:

- no allowed topics were supplied;
- category agent request failed or was truncated;
- returned primary topic was not one of the allowed IDs;
- category agent was not reached because content completion failed first.

## Tasks

### P0 - Persist incomplete questions for teacher review

- [ ] Change `QuestionCompletionService.complete` to return a partial completion result instead of `null` when alternatives, answer, or explanation cannot be completed.
- [ ] Carry `missingFields` and per-agent failure details (`agent`, error code, model, finish reason, attempt count) into `QuestionExtractionService`.
- [ ] Persist the question using its stable `sourceKey`, with `status = PENDING_REVIEW`, `needsReview = true`, and the incomplete fields explicitly recorded in metadata.
- [ ] Do not mark incomplete questions as ready or approved. They must be visible to the teacher for completion/rejection.
- [ ] Keep valid source fields. For example, retain source alternatives and answer when only explanation generation failed.
- [ ] Preserve idempotency: a reprocessing run must update the same source question rather than create duplicates.

Acceptance criteria:

```text
An explanation-agent failure still creates a visible PENDING_REVIEW question.
metadata.missingFields identifies exactly what the teacher must fill.
No incomplete question receives a ready/approved status.
```

### P0 - Run categorization even for partial questions

- [ ] Move category-agent invocation so it runs after the question draft is assembled, even when completion is partial.
- [ ] Send the statement and whichever alternatives are available to `QuestionCategoryAgentService`.
- [ ] Persist a valid primary topic when categorization succeeds.
- [ ] When it fails, persist `topicId = null`, `needsReview = true`, and diagnostic metadata instead of dropping the question.

Acceptance criteria:

```text
A partial question can still have a primary topic.
A question without a topic remains visible for review and records why categorization is pending.
```

### P0 - Verify effective worker model configuration

- [ ] Add a startup/configuration log that prints only model names, max tokens, and temperatures for each agent. Never log API keys.
- [ ] Add these same fields to `monitor.llm_structured_request_started`.
- [ ] Restart every worker process after environment changes and confirm `question_explanation` logs `maxTokens: 350` and temperature `0.4`.
- [ ] Confirm the extraction log shows `maxTokens: 4000` after the recent change.

Acceptance criteria:

```text
The log for every LLM call identifies its effective model, maxTokens, and temperature.
No completion request logs 900 tokens unless QUESTION_EXPLANATION_MAX_TOKENS is intentionally set to 900.
```

### P1 - Make extraction schema tolerant of empty source references

- [ ] Normalize `answerSourceChunkIndexes: null` and `explanationSourceChunkIndexes: null` to `[]` before or during Zod validation.
- [ ] Keep `sourceChunkIndexes` mandatory because it supports the question statement provenance.
- [ ] Keep the JSON schema and prompt aligned: absent optional provenance must be an empty array, never `null`.

Acceptance criteria:

```text
An extraction response with null optional source indexes no longer discards the entire chunk group.
```

### P1 - Improve structured-output failure handling by task

- [ ] Classify `MODEL_OUTPUT_TRUNCATED`, `EMPTY_RESPONSE`, `INVALID_JSON`, `INVALID_SCHEMA`, `429`, and `502` separately in question metadata and metrics.
- [ ] Do not retry a truncation three times with identical model, prompt, and limits. Use a fallback model or defer the task after the first repeated truncation.
- [ ] Evaluate a model/provider that reliably supports strict JSON schema for `question_explanation`; the current DeepSeek route repeatedly returns empty content with `finishReason: length`.
- [ ] Keep retries for transient provider failures such as `429` and `502`, with backoff.

### P1 - Give question extraction its own configuration name

- [ ] Introduce `QUESTION_EXTRACTION_MODEL`, `QUESTION_EXTRACTION_MAX_TOKENS`, and `QUESTION_EXTRACTION_TEMPERATURE`.
- [ ] Stop reusing `DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_MAX_TOKENS` for question extraction once the dedicated variables exist.
- [ ] Keep `DOCUMENT_BLOCK_TOPIC_CLASSIFICATION_*` limited to `CLASSIFY_BLOCKS`.

## Relevant Services

- `src/worker/services/question-extraction.service.ts`: candidate extraction and persistence.
- `src/worker/services/completeQuestion/question-completion.service.ts`: completion orchestration.
- `src/worker/services/completeQuestion/question-alternatives-agent.service.ts`: five alternatives.
- `src/worker/services/completeQuestion/question-answer-agent.service.ts`: answer determination with document RAG.
- `src/worker/services/completeQuestion/question-explanation-agent.service.ts`: pedagogical explanation.
- `src/worker/services/completeQuestion/question-category-agent.service.ts`: primary/related topic classification.
- `src/worker/client/openrouter.client.ts`: structured response parsing and error normalization.
