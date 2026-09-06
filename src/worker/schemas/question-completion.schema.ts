import { z } from 'zod';

const labels = ['A', 'B', 'C', 'D', 'E'] as const;

const alternativeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', enum: labels },
    text: { type: 'string', minLength: 1, maxLength: 180 },
  },
  required: ['label', 'text'],
} as const;

const alternativeZodSchema = z.object({
  label: z.enum(labels),
  text: z.string().min(1).max(180),
}).strict();

export const questionCompletionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    alternatives: { type: 'array', minItems: 5, maxItems: 5, items: alternativeJsonSchema },
    correctAnswer: { type: ['string', 'null'], enum: [...labels, null] },
    explanation: { type: 'string', minLength: 1, maxLength: 700 },
  },
  required: ['alternatives', 'correctAnswer', 'explanation'],
} as const;

export const explanationOnlyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { explanation: { type: 'string', minLength: 1, maxLength: 700 } },
  required: ['explanation'],
} as const;

export const answerOnlyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { correctAnswer: { type: ['string', 'null'], enum: [...labels, null] } },
  required: ['correctAnswer'],
} as const;

export const alternativesOnlyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    alternatives: { type: 'array', minItems: 5, maxItems: 5, items: alternativeJsonSchema },
  },
  required: ['alternatives'],
} as const;

export const questionCategoryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // O provider precisa aceitar null sem aplicar format em um union.
    // A validação UUID permanece no Zod e na lista de tópicos permitidos.
    primaryTopicKey: { type: ['string', 'null'] },
    relatedTopics: {
      type: 'array',
      maxItems: 4,
      items: {
          type: 'object',
        additionalProperties: false,
          properties: {
          topicKey: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topicKey', 'confidence'],
      },
    },
  },
  required: ['primaryTopicKey', 'relatedTopics'],
} as const;

export const questionQualityReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean' },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasons: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 180 } },
    recommendedAction: { type: 'string', enum: ['REVIEW', 'CORRECT', 'REPROCESS', 'DUPLICATE', 'KEEP'] },
  },
  required: ['valid', 'score', 'severity', 'confidence', 'reasons', 'recommendedAction'],
} as const;

export const questionBoundaryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['CONFIRMED', 'NEEDS_PREVIOUS', 'NEEDS_NEXT', 'CONTAMINATED', 'MULTI_ITEM', 'INSUFFICIENT_EVIDENCE'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', minLength: 1, maxLength: 220 },
    relevantChunkIndexes: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 6 },
  },
  required: ['decision', 'confidence', 'reason', 'relevantChunkIndexes'],
} as const;

const questionPatchProperties = {
  statement: { type: ['string', 'null'], maxLength: 5000 },
  alternatives: { type: ['array', 'null'], maxItems: 5, items: alternativeJsonSchema },
  correctAnswer: { type: ['string', 'null'], enum: [...labels, null] },
  explanation: { type: ['string', 'null'], maxLength: 700 },
  changedFields: { type: 'array', items: { type: 'string', enum: ['statement', 'alternatives', 'correctAnswer', 'explanation'] }, maxItems: 4 },
} as const;

const questionPatchRequired = ['statement', 'alternatives', 'correctAnswer', 'explanation', 'changedFields'];

export const questionQualityNormalizationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['NORMALIZED', 'PARTIAL_NORMALIZATION', 'UNCHANGED', 'REVIEW_REQUIRED'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    changes: { type: 'object', additionalProperties: false, properties: questionPatchProperties, required: questionPatchRequired },
    fieldActions: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(['statement', 'alternatives', 'correctAnswer', 'explanation'].map((field) => [field, { type: 'string', enum: ['KEPT', 'CORRECTED', 'GENERATED', 'REMOVED', 'UNVERIFIED'] }])),
      required: ['statement', 'alternatives', 'correctAnswer', 'explanation'],
    },
    checks: {
      type: 'object',
      additionalProperties: false,
      properties: {
        statementMakesSense: { type: 'boolean' },
        alternativesMatchStatement: { type: 'boolean' },
        answerMatchesAlternative: { type: 'boolean' },
        explanationMatchesAnswer: { type: 'boolean' },
        solvable: { type: 'boolean' },
      },
      required: ['statementMakesSense', 'alternativesMatchStatement', 'answerMatchesAlternative', 'explanationMatchesAnswer', 'solvable'],
    },
    evidence: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 180 } },
  },
  required: ['decision', 'confidence', 'changes', 'fieldActions', 'checks', 'evidence'],
} as const;

const questionPatchZodSchema = z.object({
  statement: z.string().max(5000).nullable(),
  alternatives: z.array(alternativeZodSchema).max(5).nullable(),
  correctAnswer: z.enum(labels).nullable(),
  explanation: z.string().max(700).nullable(),
  changedFields: z.array(z.enum(['statement', 'alternatives', 'correctAnswer', 'explanation'])).max(4),
}).strict();

export const questionSourceReconstructionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changes: { type: 'object', additionalProperties: false, properties: questionPatchProperties, required: questionPatchRequired },
    changed: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 160 } },
    recommendedAction: { type: 'string', enum: ['REVIEW', 'REPROCESS', 'KEEP'] },
  },
  required: ['changes', 'changed', 'confidence', 'evidence', 'recommendedAction'],
} as const;

export const questionQualityCorrectionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['CORRECT', 'REPROCESS', 'REVIEW'] },
    changes: { type: 'object', additionalProperties: false, properties: questionPatchProperties, required: questionPatchRequired },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 160 } },
  },
  required: ['action', 'changes', 'confidence', 'evidence'],
} as const;

export const questionCompletionZodSchema = z.object({
  alternatives: z.array(alternativeZodSchema).length(5),
  correctAnswer: z.enum(labels).nullable(),
  explanation: z.string().min(1).max(700),
}).strict();

export const explanationOnlyZodSchema = z.object({
  explanation: z.string().min(1).max(700),
}).strict();

export const answerOnlyZodSchema = z.object({
  correctAnswer: z.enum(labels).nullable(),
}).strict();

export const alternativesOnlyZodSchema = z.object({
  alternatives: z.array(alternativeZodSchema).length(5),
}).strict();

export const questionCategoryZodSchema = z.object({
  primaryTopicKey: z.string().uuid().nullable(),
  relatedTopics: z.array(z.object({
    topicKey: z.string().uuid(),
    confidence: z.number().min(0).max(1),
  }).strict()).max(4),
}).strict();

export const questionQualityReviewZodSchema = z.object({
  valid: z.boolean(),
  score: z.number().int().min(0).max(100),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1).max(180)).max(8),
  recommendedAction: z.enum(['REVIEW', 'CORRECT', 'REPROCESS', 'DUPLICATE', 'KEEP']),
}).strict();

export const questionQualityNormalizationZodSchema = z.object({
  decision: z.enum(['NORMALIZED', 'PARTIAL_NORMALIZATION', 'UNCHANGED', 'REVIEW_REQUIRED']),
  confidence: z.number().min(0).max(1),
  changes: questionPatchZodSchema,
  fieldActions: z.object({
    statement: z.enum(['KEPT', 'CORRECTED', 'GENERATED', 'REMOVED', 'UNVERIFIED']),
    alternatives: z.enum(['KEPT', 'CORRECTED', 'GENERATED', 'REMOVED', 'UNVERIFIED']),
    correctAnswer: z.enum(['KEPT', 'CORRECTED', 'GENERATED', 'REMOVED', 'UNVERIFIED']),
    explanation: z.enum(['KEPT', 'CORRECTED', 'GENERATED', 'REMOVED', 'UNVERIFIED']),
  }).strict(),
  checks: z.object({
    statementMakesSense: z.boolean(),
    alternativesMatchStatement: z.boolean(),
    answerMatchesAlternative: z.boolean(),
    explanationMatchesAnswer: z.boolean(),
    solvable: z.boolean(),
  }).strict(),
  evidence: z.array(z.string().min(1).max(180)).max(5),
}).strict();

export const questionBoundaryZodSchema = z.object({
  decision: z.enum(['CONFIRMED', 'NEEDS_PREVIOUS', 'NEEDS_NEXT', 'CONTAMINATED', 'MULTI_ITEM', 'INSUFFICIENT_EVIDENCE']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(220),
  relevantChunkIndexes: z.array(z.number().int().nonnegative()).max(6),
}).strict();

export const questionSourceReconstructionZodSchema = z.object({
  changes: questionPatchZodSchema,
  changed: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(160)).max(4),
  recommendedAction: z.enum(['REVIEW', 'REPROCESS', 'KEEP']),
}).strict();

export const questionQualityCorrectionZodSchema = z.object({
  action: z.enum(['CORRECT', 'REPROCESS', 'REVIEW']),
  changes: questionPatchZodSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(160)).max(4),
}).strict();
