# Knowledge base uploads do not extract questions

## Goal

Uploading a document with the `KNOWLEDGE_BASE` tag should process and store it as knowledge for retrieval without automatically extracting questions. Uploads tagged `QUESTIONS` should continue to run question extraction.

## Scope

- Restrict `EXTRACT_QUESTIONS_TO_PENDING_REVIEW` to documents tagged `QUESTIONS`.
- Mark that operation skipped for `KNOWLEDGE_BASE` documents, with a reason indicating their tag.
- Preserve text extraction, block detection, chunking, embeddings, topic profile generation, and document status behavior for knowledge uploads.
- Keep `FLASHCARDS` behavior unchanged.
- Add worker-level regression coverage for the knowledge and questions tag branches.

## Acceptance criteria

1. Processing a `KNOWLEDGE_BASE` document never calls `QuestionExtractionService.processDocument` and records question extraction as skipped.
2. Processing a `QUESTIONS` document still calls question extraction.
3. Knowledge uploads can still finish `READY` (or `PARTIAL_SUCCESS` for unrelated non-blocking failures) with their knowledge pipeline intact.

## Verification

Use TDD: add and run a failing worker test before changing production code, then run the focused document worker test suite and backend typecheck.
