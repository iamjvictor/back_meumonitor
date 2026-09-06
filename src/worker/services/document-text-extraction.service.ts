import {
  saveDocumentTextExtraction,
} from '../../repositories/document-worker.repository.js';
import {
  findRepeatedPageLines,
  TextNormalizationService,
} from './text-normalization.service.js';

const EXTRACTION_VERSION = 'pdf-layout-v2-column-aware';
const MIN_CHARS_PER_PAGE = 80;
const REPLACEMENT_CHARACTER = '\uFFFD';

type ParsedPdfPage = {
  num: number;
  text: string;
  hasImages?: boolean;
  imageCount?: number;
};

export type ParsedPdfText = {
  text: string;
  total: number;
  pages: ParsedPdfPage[];
};

export type DocumentTextExtractionResult = {
  documentTextId: string;
  quality: 'GOOD' | 'PARTIAL' | 'NEEDS_OCR' | 'FAILED';
  shouldStopProcessing: boolean;
  rawContent: string;
  normalizedContent: string | null;
  pageCount: number;
};

function buildPageOffsets(pages: Array<{ content: string }>) {
  let cursor = 0;

  return pages.map((page, index) => {
    const charStart = cursor;
    const charEnd = charStart + page.content.length;
    cursor = charEnd + (index === pages.length - 1 ? 0 : 2);
    return { charStart, charEnd };
  });
}

function assessQuality(parsedPdf: ParsedPdfText, documentSizeBytes: number) {
  const rawContent = parsedPdf.text ?? '';
  const pages = parsedPdf.pages ?? [];
  const pageCount = parsedPdf.total || pages.length;
  const trimmedLength = rawContent.trim().length;
  const replacementCharacterCount = [...rawContent]
    .filter((character) => character === REPLACEMENT_CHARACTER).length;
  const nonEmptyPageCount = pages.filter((page) => page.text.trim().length > 0).length;
  const emptyPageCount = Math.max(pageCount - nonEmptyPageCount, 0);
  const charsPerPage = pageCount > 0 ? trimmedLength / pageCount : trimmedLength;
  const replacementCharacterRatio = rawContent.length > 0
    ? replacementCharacterCount / rawContent.length
    : 0;

  let quality: 'GOOD' | 'PARTIAL' | 'NEEDS_OCR' | 'FAILED' = 'GOOD';
  if (trimmedLength === 0) {
    quality = 'FAILED';
  } else if (
    (pageCount > 0 && nonEmptyPageCount === 0)
    || (pageCount > 0 && charsPerPage < MIN_CHARS_PER_PAGE && emptyPageCount > 0)
  ) {
    quality = 'NEEDS_OCR';
  } else if (replacementCharacterRatio > 0.005 || emptyPageCount > 0) {
    quality = 'PARTIAL';
  }

  return {
    quality,
    qualityDetails: {
      parser: 'pdfjs-layout-adapter',
      parserVersion: '5.x-transitive',
        extractionMethod: pages.length > 0 ? 'pdf-layout-pages-columns' : 'pdf-layout-aggregate',
        pagesWithImages: pages.filter((page) => page.hasImages === true).map((page) => page.num),
        imageCount: pages.reduce((total, page) => total + (page.imageCount ?? 0), 0),
      fallbackPageMarkersUsed: false,
      documentSizeBytes,
      textChars: rawContent.length,
      nonWhitespaceChars: trimmedLength,
      pageCount,
      nonEmptyPageCount,
      emptyPageCount,
      charsPerPage: Math.round(charsPerPage),
      replacementCharacterCount,
      replacementCharacterRatio,
      minCharsPerPage: MIN_CHARS_PER_PAGE,
    },
    pageCount,
  };
}

export class DocumentTextExtractionService {
  constructor(private readonly normalizationService = new TextNormalizationService()) {}

  async process(
    documentId: string,
    parsedPdf: ParsedPdfText,
    documentSizeBytes: number,
  ): Promise<DocumentTextExtractionResult> {
    const startedAt = Date.now();
    const rawContent = parsedPdf.text ?? '';
    const pages = parsedPdf.pages ?? [];
    const qualityResult = assessQuality(parsedPdf, documentSizeBytes);
    const repeatedPageLines = findRepeatedPageLines(pages.map((page) => page.text));
    const normalizedPages = (qualityResult.quality === 'GOOD' || qualityResult.quality === 'PARTIAL')
      ? pages.map((page) => ({
        pageNumber: page.num,
        rawContent: page.text,
        normalizedContent: this.normalizationService.normalize(page.text, { repeatedPageLines }).normalizedContent,
        hasImages: page.hasImages ?? null,
      }))
      : [];
    const normalizedContent = normalizedPages.map((page) => page.normalizedContent).join('\n\n').trim();
    const normalization = normalizedContent
      ? this.normalizationService.normalize(normalizedContent)
      : null;
    const offsets = buildPageOffsets(normalizedPages.map((page) => ({ content: page.normalizedContent })));

    console.log('Avaliando qualidade da extracao de texto', {
      event: 'monitor.document_text_quality_assessment_started',
      documentId,
      textChars: rawContent.length,
      pageCount: qualityResult.pageCount,
      quality: qualityResult.quality,
    });

    const extraction = await saveDocumentTextExtraction({
      documentId,
      extractionVersion: EXTRACTION_VERSION,
      rawContent,
      normalizedContent: normalizedContent || null,
      pageCount: qualityResult.pageCount || null,
      quality: qualityResult.quality,
      qualityDetails: {
        ...qualityResult.qualityDetails,
        normalization: {
          version: 'controlled-v1',
          rulesApplied: normalization?.rulesApplied ?? [],
          repeatedPageLines: normalization?.repeatedPageLines ?? [],
        },
      },
      pages: normalizedPages.map((page, index) => ({
        pageNumber: page.pageNumber,
        rawContent: page.rawContent,
        normalizedContent: page.normalizedContent || null,
        hasImages: page.hasImages ?? null,
        charStart: offsets[index]?.charStart ?? null,
        charEnd: offsets[index]?.charEnd ?? null,
      })),
    });

    console.log('Extracao de texto persistida', {
      event: 'monitor.document_text_extraction_persisted',
      documentId,
      documentTextId: extraction.id,
      extractionVersion: EXTRACTION_VERSION,
      quality: qualityResult.quality,
      pageCount: qualityResult.pageCount,
      durationMs: Date.now() - startedAt,
    });

    return {
      documentTextId: extraction.id,
      quality: qualityResult.quality,
      shouldStopProcessing: qualityResult.quality === 'NEEDS_OCR' || qualityResult.quality === 'FAILED',
      rawContent,
      normalizedContent: normalizedContent || null,
      pageCount: qualityResult.pageCount,
    };
  }
}
