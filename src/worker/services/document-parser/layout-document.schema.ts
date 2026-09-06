import { z } from 'zod';

import type {
  BoundingBox,
  DocumentParserName,
  LayoutCategory,
  LayoutDocument,
} from './document-parser.types.js';

const documentParserNameSchema = z.union([
  z.literal('PDFJS'),
  z.literal('MINERU'),
  z.literal('PADDLE'),
  z.literal('DOCLING'),
]);

const layoutCategorySchema = z.union([
  z.literal('TITLE'),
  z.literal('TEXT'),
  z.literal('LIST'),
  z.literal('TABLE'),
  z.literal('FIGURE'),
  z.literal('FORMULA'),
  z.literal('CAPTION'),
  z.literal('HEADER'),
  z.literal('FOOTER'),
  z.literal('PAGE_NUMBER'),
  z.literal('FOOTNOTE'),
  z.literal('UNKNOWN'),
]);

const boundingBoxSchema = z.object({
  x0: z.number().finite(),
  y0: z.number().finite(),
  x1: z.number().finite(),
  y1: z.number().finite(),
  coordinateSpace: z.literal('NORMALIZED_1000'),
}).superRefine((box, ctx) => {
  if (box.x0 > box.x1 || box.y0 > box.y1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'BoundingBox inválida.',
    });
  }
});

const visualAssetSchema = z.object({
  id: z.string().min(1),
  type: z.union([
    z.literal('FIGURE'),
    z.literal('TABLE'),
    z.literal('FORMULA'),
    z.literal('CROP'),
    z.literal('LAYOUT_DEBUG'),
  ]),
  pageNumber: z.number().int().positive(),
  storagePath: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  bbox: boundingBoxSchema.optional(),
  checksum: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const layoutElementSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().min(1).optional(),
  pageNumber: z.number().int().positive(),
  readingOrder: z.number().int().nonnegative(),
  category: layoutCategorySchema,
  rawText: z.string().optional(),
  normalizedText: z.string().optional(),
  latex: z.string().optional(),
  html: z.string().optional(),
  bbox: boundingBoxSchema,
  columnIndex: z.number().int().nonnegative().optional(),
  confidence: z.number().finite().optional(),
  parentElementId: z.string().min(1).optional(),
  assetIds: z.array(z.string().min(1)),
  parserMetadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const layoutPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  elements: z.array(layoutElementSchema),
}).strict();

export const layoutDocumentSchema = z.object({
  schemaVersion: z.literal('layout-v1'),
  documentId: z.string().min(1),
  parseRunId: z.string().min(1),
  parser: z.object({
    name: documentParserNameSchema,
    version: z.string().min(1),
    backend: z.string().min(1).optional(),
    modelVersion: z.string().min(1).optional(),
    configurationHash: z.string().min(1),
  }).strict(),
  pages: z.array(layoutPageSchema),
  assets: z.array(visualAssetSchema),
  warnings: z.array(z.string()),
}).strict().superRefine((document, ctx) => {
  const assetIds = new Set(document.assets.map((asset) => asset.id));

  for (const [pageIndex, page] of document.pages.entries()) {
    for (const [elementIndex, element] of page.elements.entries()) {
      for (const assetId of element.assetIds) {
        if (!assetIds.has(assetId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `LayoutDocument.pages[${pageIndex}].elements[${elementIndex}].assetIds referencia asset ausente: ${assetId}.`,
            path: ['pages', pageIndex, 'elements', elementIndex, 'assetIds'],
          });
        }
      }
    }
  }
});

export function assertLayoutDocument(value: unknown): LayoutDocument {
  return layoutDocumentSchema.parse(value) as LayoutDocument;
}

export type LayoutBoundingBox = BoundingBox;
export type LayoutDocumentCategory = LayoutCategory;
export type LayoutDocumentParserName = DocumentParserName;
