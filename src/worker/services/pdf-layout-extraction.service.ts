export type LayoutTextItem = { text: string; x: number; y: number; width: number; height: number };
export type LayoutPage = { num: number; text: string; items: LayoutTextItem[]; columns: number; hasImages: boolean; imageCount: number };

type PdfJsModule = {
  getDocument(input: Record<string, unknown>): { promise: Promise<any> };
  OPS?: { paintImageMask?: number; paintImageXObject?: number; paintJpegXObject?: number };
};

export async function extractPdfPagesWithLayout(data: Uint8Array): Promise<LayoutPage[]> {
  // pdfjs-dist 5 is ESM and does not expose stable TypeScript types for this worker context.
  // The adapter keeps the rest of the pipeline independent from that implementation detail.
  // @ts-ignore -- runtime package is provided transitively by pdf-parse.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as PdfJsModule;
  const document = await pdfjs.getDocument({ data, disableWorker: true, useSystemFonts: true }).promise;
  const pages: LayoutPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: LayoutTextItem[] = content.items
      .filter((item: any) => typeof item.str === 'string' && item.str.trim())
      .map((item: any) => ({
        text: item.str.trim(),
        x: Number(item.transform?.[4] ?? 0),
        y: Number(item.transform?.[5] ?? 0),
        width: Number(item.width ?? 0),
        height: Math.abs(Number(item.height ?? item.transform?.[3] ?? 0)),
      }));
    const pageWidth = page.getViewport({ scale: 1 }).width;
    const imageOperators = new Set([
      pdfjs.OPS?.paintImageMask,
      pdfjs.OPS?.paintImageXObject,
      pdfjs.OPS?.paintJpegXObject,
    ].filter((value): value is number => typeof value === 'number'));
    let imageCount = 0;
    try {
      const operatorList = await page.getOperatorList();
      imageCount = operatorList.fnArray.filter((operator: number) => imageOperators.has(operator)).length;
    } catch {
      // Falha de inspeção visual não deve derrubar a extração textual. Nesse
      // caso, a página fica sem evidência visual confirmada e a questão poderá
      // ser encaminhada para revisão se depender de uma figura.
      imageCount = 0;
    }
    pages.push({
      num: pageNumber,
      items,
      columns: detectColumnCount(items, pageWidth),
      text: orderItems(items, pageWidth),
      hasImages: imageCount > 0,
      imageCount,
    });
  }
  return pages;
}

function detectColumnCount(items: LayoutTextItem[], pageWidth: number) {
  if (items.length < 12) return 1;

  // Headers, page numbers and centered titles often create large x gaps that
  // are not column boundaries. Detect columns from the body and require a
  // meaningful amount of text on both sides of the page midpoint.
  const minY = Math.min(...items.map((item) => item.y));
  const maxY = Math.max(...items.map((item) => item.y));
  const ySpan = Math.max(1, maxY - minY);
  const bodyItems = items.filter((item) => {
    const relativeY = (item.y - minY) / ySpan;
    return relativeY > 0.05 && relativeY < 0.95;
  });
  const candidates = bodyItems.length >= 16 ? bodyItems : items;
  const midpoint = pageWidth / 2;
  const left = candidates.filter((item) => item.x < midpoint);
  const right = candidates.filter((item) => item.x >= midpoint);
  if (left.length < 8 || right.length < 8) return 1;

  const leftEdge = Math.max(...left.map((item) => item.x + Math.max(0, item.width)));
  const rightEdge = Math.min(...right.map((item) => item.x));
  const gutter = rightEdge - leftEdge;

  // In the source workbook the two body columns are separated by roughly
  // 20–40 points, so the previous 12% threshold (around 70 points) missed
  // every real two-column page.
  return gutter >= Math.max(12, pageWidth * 0.02) ? 2 : 1;
}

function orderItems(items: LayoutTextItem[], pageWidth: number) {
  if (items.length === 0) return '';
  const columns = detectColumnCount(items, pageWidth);
  const groups = columns === 1 ? [items] : [
    items.filter((item) => item.x < pageWidth / 2),
    items.filter((item) => item.x >= pageWidth / 2),
  ];
  return groups.map((group) => groupLines(group)).filter(Boolean).join('\n').trim();
}

function groupLines(items: LayoutTextItem[]) {
  const lines: Array<{ y: number; items: LayoutTextItem[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(3, item.height * 0.45));
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' ')).join('\n');
}
