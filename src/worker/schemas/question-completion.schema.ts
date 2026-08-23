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
    primaryTopicIndex: { type: ['integer', 'null'], minimum: 0 },
    relatedTopics: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topicIndex: { type: 'integer', minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topicIndex', 'confidence'],
      },
    },
  },
  required: ['primaryTopicIndex', 'relatedTopics'],
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
  primaryTopicIndex: z.number().int().nonnegative().nullable(),
  relatedTopics: z.array(z.object({
    topicIndex: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
  }).strict()).max(4),
}).strict();
