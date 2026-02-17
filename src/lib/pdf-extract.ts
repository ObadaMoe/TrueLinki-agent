import { createCanvas } from "@napi-rs/canvas";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl?: string;
}

export interface PDFExtractionResult {
  pages: ExtractedPage[];
  totalPages: number;
  rawText: string;
  filename?: string;
  isScanned: boolean;
}

const MAX_TEXT_CHARS = 50_000;

/**
 * Custom CanvasFactory for pdfjs-dist that uses @napi-rs/canvas.
 * Required because pdfjs-dist has no built-in canvas support in Node.js.
 */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(
    canvasAndContext: { canvas: any; context: any },
    width: number,
    height: number
  ) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: any; context: any }) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Select which pages to render as images for visual analysis.
 *
 * For scanned PDFs (no extractable text), render ALL pages up to maxPages.
 * For text-based PDFs, prioritize cover pages, cert pages, and pages with
 * short text (likely tables, stamps, images).
 */
function selectPagesForImages(
  pageTexts: string[],
  maxPages: number,
  isScanned: boolean
): number[] {
  if (isScanned) {
    const all: number[] = [];
    for (let i = 1; i <= Math.min(pageTexts.length, maxPages); i++) {
      all.push(i);
    }
    return all;
  }

  const selected = new Set<number>();

  for (let i = 1; i <= Math.min(3, pageTexts.length); i++) {
    selected.add(i);
  }

  for (let i = Math.max(1, pageTexts.length - 1); i <= pageTexts.length; i++) {
    selected.add(i);
  }

  if (pageTexts.length > 0) {
    const avgLen =
      pageTexts.reduce((s, t) => s + t.length, 0) / pageTexts.length;
    for (let i = 0; i < pageTexts.length; i++) {
      if (selected.size >= maxPages) break;
      if (pageTexts[i].length < avgLen * 0.3) {
        selected.add(i + 1);
      }
    }
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .slice(0, maxPages);
}

/**
 * Render a single PDF page to a PNG data URL using pdfjs-dist
 * with @napi-rs/canvas.
 */
async function renderPage(
  pdf: any,
  pageNum: number,
  scale: number
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}

/**
 * Load PDF with pdfjs-dist (the only pdfjs library used — avoids version
 * conflicts with unpdf's bundled copy).
 */
async function loadPdf(pdfBytes: Uint8Array) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Point to the matching worker file so pdfjs runs on the main thread
  // without spawning a Web Worker (Node.js "fake worker" mode).
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "pdfjs-dist/legacy/build/pdf.worker.mjs";

  return pdfjsLib
    .getDocument({
      data: pdfBytes,
      verbosity: 0,
      isEvalSupported: false,
      canvasFactory: new NodeCanvasFactory() as any,
    } as any)
    .promise;
}

/**
 * Extract text from all pages using pdfjs-dist's getTextContent API.
 */
async function extractTextFromPages(pdf: any): Promise<string[]> {
  const numPages = pdf.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .filter((item: any) => "str" in item)
      .map((item: any) => item.str)
      .join(" ");
    pageTexts.push(text);
  }

  return pageTexts;
}

/**
 * Extract text and render selected pages as images from a base64-encoded PDF.
 *
 * Uses pdfjs-dist exclusively (not unpdf) to avoid version conflicts between
 * pdfjs-dist and unpdf's bundled pdfjs copy.
 */
export async function extractPDF(
  dataUrl: string,
  options?: {
    maxImagePages?: number;
    imageScale?: number;
    filename?: string;
  }
): Promise<PDFExtractionResult> {
  const maxImagePages = options?.maxImagePages ?? 10;
  const imageScale = options?.imageScale ?? 1.5;
  const filename = options?.filename;

  // Parse data URL to Uint8Array
  const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
  if (!base64Match) {
    throw new Error("Invalid PDF data URL");
  }
  const pdfBytes = new Uint8Array(Buffer.from(base64Match[1], "base64"));

  // Load PDF with pdfjs-dist
  const pdf = await loadPdf(pdfBytes);

  // Extract text from all pages
  const pageTexts = await extractTextFromPages(pdf);

  // Detect scanned/image-based PDF
  const totalTextLength = pageTexts.reduce((s, t) => s + t.length, 0);
  const isScanned = totalTextLength < 100;

  // Select pages for image rendering
  const imagePagesNumbers = selectPagesForImages(
    pageTexts,
    maxImagePages,
    isScanned
  );

  // Render selected pages as images
  const imageMap = new Map<number, string>();
  for (const pageNum of imagePagesNumbers) {
    try {
      const imgDataUrl = await renderPage(pdf, pageNum, imageScale);
      imageMap.set(pageNum, imgDataUrl);
    } catch (err) {
      console.warn(`Failed to render page ${pageNum} as image:`, err);
    }
  }

  pdf.destroy();

  // Build pages array
  const pages: ExtractedPage[] = pageTexts.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
    imageDataUrl: imageMap.get(idx + 1),
  }));

  // Build raw text
  let rawText: string;
  if (isScanned) {
    rawText =
      `[This is a scanned/image-based PDF with ${pageTexts.length} pages. ` +
      `Text extraction returned no content. Analysis relies entirely on page images.]`;
  } else {
    rawText = pageTexts
      .map((text, idx) => `--- PAGE ${idx + 1} ---\n${text}`)
      .join("\n\n");

    if (rawText.length > MAX_TEXT_CHARS) {
      rawText =
        rawText.slice(0, MAX_TEXT_CHARS) +
        "\n\n[... text truncated due to length ...]";
    }
  }

  return {
    pages,
    totalPages: pageTexts.length,
    rawText,
    filename,
    isScanned,
  };
}
