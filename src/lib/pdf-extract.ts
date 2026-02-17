export interface PDFExtractionResult {
  /** Raw PDF as base64 string (without data URL prefix) */
  pdfBase64: string;
  /** Original filename if provided */
  filename?: string;
}

/**
 * Parse a PDF data URL and extract the raw base64 string.
 *
 * All PDF processing (text extraction, image analysis, table parsing)
 * is delegated to Gemini 2.5 Flash which handles PDFs natively —
 * text-based, scanned, and mixed documents alike.
 */
export async function extractPDF(
  dataUrl: string,
  options?: { filename?: string }
): Promise<PDFExtractionResult> {
  const base64Match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
  if (!base64Match) {
    throw new Error("Invalid PDF data URL");
  }

  return {
    pdfBase64: base64Match[1],
    filename: options?.filename,
  };
}
