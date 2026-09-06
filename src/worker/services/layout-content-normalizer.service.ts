import type {
  BoundingBox,
  LayoutCategory,
  LayoutDocument,
  LayoutElement,
  VisualAsset,
} from './document-parser/document-parser.types.js';

export type NormalizedLayoutElement = LayoutElement & {
  isSemantic: boolean;
};

export type NormalizedLayoutContent = {
  documentId: string;
  parseRunId: string;
  pages: LayoutDocument['pages'];
  elements: NormalizedLayoutElement[];
  semanticElements: NormalizedLayoutElement[];
  assets: VisualAsset[];
  warnings: string[];
};

const SEMANTIC_EXCLUSIONS = new Set<LayoutCategory>(['HEADER', 'FOOTER', 'PAGE_NUMBER', 'FOOTNOTE']);

export function normalizeLayoutContent(document: LayoutDocument): NormalizedLayoutContent {
  const elements = document.pages.flatMap((page) => page.elements.map((element) => ({
    ...element,
    assetIds: [...element.assetIds],
    parserMetadata: element.parserMetadata ? { ...element.parserMetadata } : undefined,
    isSemantic: !SEMANTIC_EXCLUSIONS.has(element.category),
  })));

  return {
    documentId: document.documentId,
    parseRunId: document.parseRunId,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => ({
        ...element,
        assetIds: [...element.assetIds],
        parserMetadata: element.parserMetadata ? { ...element.parserMetadata } : undefined,
      })),
    })),
    elements,
    semanticElements: elements.filter((element) => element.isSemantic),
    assets: document.assets.map((asset) => ({ ...asset, metadata: asset.metadata ? { ...asset.metadata } : undefined })),
    warnings: [...document.warnings],
  };
}

export function isCorruptedLatex(latex: string | null | undefined) {
  if (!latex) return false;
  const openBraces = (latex.match(/{/g) ?? []).length;
  const closeBraces = (latex.match(/}/g) ?? []).length;
  if (openBraces !== closeBraces) return true;
  if (/\\frac(?:\s*|{[^}]*$)/.test(latex)) return true;
  if (/\\sqrt(?:\s*|{[^}]*$)/.test(latex)) return true;
  return false;
}

export function normalizeBoundingBox(box: BoundingBox): BoundingBox {
  return { ...box };
}
