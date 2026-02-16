import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

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
}

const MAX_TEXT_CHARS = 50_000;

/**
 * Select which pages to render as images for visual analysis.
 * Prioritizes: first 3 pages (cover/DRS), last 2 pages (certs/signatures),
 * and pages with short text (likely tables, stamps, images).
 */
function selectPagesForImages(
  pageTexts: string[],
  maxPages: number
): number[] {
  const selected = new Set<number>();

  // First 3 pages (cover sheet, DRS form, intro)
  for (let i = 1; i <= Math.min(3, pageTexts.length); i++) {
    selected.add(i);
  }

  // Last 2 pages (certificates, signatures)
  for (let i = Math.max(1, pageTexts.length - 1); i <= pageTexts.length; i++) {
    selected.add(i);
  }

  // Pages with short text (likely tables/images/stamps that text extraction missed)
  if (pageTexts.length > 0) {
    const avgLen =
      pageTexts.reduce((s, t) => s + t.length, 0) / pageTexts.length;
    for (let i = 0; i < pageTexts.length; i++) {
      if (selected.size >= maxPages) break;
      if (pageTexts[i].length < avgLen * 0.3 && pageTexts[i].length > 0) {
        selected.add(i + 1); // 1-indexed
      }
    }
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .slice(0, maxPages);
}

/**
 * Extract text and render selected pages as images from a base64-encoded PDF.
 */
export async function extractPDF(
  dataUrl: string,
  options?: {
    maxImagePages?: number;
    imageScale?: number;
    filename?: string;
  }
): Promise<PDFExtractionResult> {
  const maxImagePages = options?.maxImagePages ?? 8;
  const imageScale = options?.imageScale ?? 1.5;
  const filename = options?.filename;

  // Parse data URL to Uint8Array
  const base64Match = dataUrl.match(
    /^data:application\/pdf;base64,(.+)$/
  );
  if (!base64Match) {
    throw new Error("Invalid PDF data URL");
  }
  const pdfBytes = new Uint8Array(
    Buffer.from(base64Match[1], "base64")
  );

  // Get document proxy
  const pdf = await getDocumentProxy(pdfBytes, { verbosity: 0 });

  // Extract text from all pages
  const { text: pageTexts } = await extractText(pdf, { mergePages: false });

  // Select pages for image rendering
  const imagePagesNumbers = selectPagesForImages(pageTexts, maxImagePages);

  // Render selected pages as images
  const imageMap = new Map<number, string>();
  for (const pageNum of imagePagesNumbers) {
    try {
      const dataUrlResult = await renderPageAsImage(pdf, pageNum, {
        scale: imageScale,
        toDataURL: true,
      });
      imageMap.set(pageNum, dataUrlResult);
    } catch (err) {
      console.warn(`Failed to render page ${pageNum} as image:`, err);
      // Continue with other pages
    }
  }

  await pdf.destroy();

  // Build pages array
  const pages: ExtractedPage[] = pageTexts.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
    imageDataUrl: imageMap.get(idx + 1),
  }));

  // Build raw text with truncation if needed
  let rawText = pageTexts
    .map((text, idx) => `--- PAGE ${idx + 1} ---\n${text}`)
    .join("\n\n");

  if (rawText.length > MAX_TEXT_CHARS) {
    rawText =
      rawText.slice(0, MAX_TEXT_CHARS) +
      "\n\n[... text truncated due to length ...]";
  }

  return {
    pages,
    totalPages: pageTexts.length,
    rawText,
    filename,
  };
}
