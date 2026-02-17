import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { PDFExtractionResult } from "./pdf-extract";

const ANALYSIS_PROMPT = `You are a construction document analyst specializing in Qatar construction projects. Analyze the provided submittal document and extract structured information.

## Document Types You May Encounter
- **Material Submittal Approval (MAR)**: Cover sheet with material details, manufacturer, supplier
- **Document Review Sheet (DRS)**: Table with reviewer comments, contractor responses, and compliance status (Complied/Not Complied/Excluded/Noted)
- **Pre-Qualification Documents**: Contractor/supplier qualification forms
- **Test Certificates**: Lab test results, mill certificates, fire resistance reports
- **Third-Party Certifications**: Intertek, UL, QCDD (Qatar Civil Defence) certificates
- **Technical Data Sheets**: Product specifications from manufacturers

## What to Extract
- Identify ALL materials, products, and systems mentioned
- Note ALL standards referenced (ASTM, BS, EN, ISO, NFPA, QCS, etc.)
- Record any existing approval stamps, action codes (A=Approved, B=Approved as Noted, C=Revise & Resubmit, D=Rejected)
- Extract test results with their values and pass/fail status
- Identify certificates with their issuers, reference numbers, and validity dates
- Note Arabic text content and its purpose (often QCDD certificates, project names)
- Record DRS item statuses (Complied, Not Complied, Excluded, Noted)

## CRITICAL: Scanned / Image-Based Documents
If the document text extraction returned no content, you MUST rely on the PAGE IMAGES to extract information. Look carefully at each image for:
- Headers, titles, logos, and project names
- Tables with material properties or test results
- Stamps, signatures, approval marks, and action codes
- Certificate headers and reference numbers
- Any visible text in the scanned images (even partial)
- Drawing title blocks with material specifications
- Arabic text that identifies authorities or certifications
DO NOT return empty or generic results — always attempt to extract whatever is visible in the images.

## Suggested QCS Queries
Based on the materials and specifications found, suggest specific search queries that would retrieve the most relevant QCS 2024 sections. Be specific — e.g., "fire rated steel doors BS 476 requirements" rather than just "steel doors".
IMPORTANT: You MUST always provide at least 3 suggested QCS queries. Even if you cannot identify specific materials, suggest queries about:
- The general document type (e.g., "submittal documentation requirements")
- Any construction topic you can infer from the document (e.g., from drawings, images, project name)
- General material testing and certification requirements`;

// OpenAI structured output requires ALL properties in "required" —
// use .nullable() instead of .optional() so the field is present but can be null.
export const SubmittalAnalysisSchema = z.object({
  documentType: z
    .enum([
      "material_submittal",
      "mix_design",
      "method_statement",
      "test_report",
      "shop_drawing",
      "certificate",
      "prequalification",
      "drs_form",
      "combined_package",
      "other",
    ])
    .describe("The type of construction submittal document"),

  title: z.string().describe("Document title or subject"),

  contractor: z.string().nullable().describe("Contractor name"),
  project: z.string().nullable().describe("Project name"),
  submittalNumber: z.string().nullable().describe("Submittal reference number"),
  revision: z.string().nullable().describe("Revision number"),

  materials: z
    .array(
      z.object({
        name: z.string(),
        manufacturer: z.string().nullable(),
        supplier: z.string().nullable(),
        standard: z
          .string()
          .nullable()
          .describe("Referenced standard (e.g., BS 476, ASTM C150)"),
        properties: z
          .array(
            z.object({
              key: z.string(),
              value: z.string(),
            })
          )
          .describe("Key properties as key-value pairs"),
      })
    )
    .describe("Materials and products listed in the submittal"),

  standardsCited: z
    .array(z.string())
    .describe("All standards referenced (ASTM, BS, EN, ISO, NFPA, QCS, etc.)"),

  existingApprovals: z
    .array(
      z.object({
        actionCode: z
          .string()
          .describe("Action code: A=Approved, B=Approved as Noted, C=Revise & Resubmit, D=Rejected"),
        authority: z.string().nullable().describe("Who approved (consultant, engineer, etc.)"),
        date: z.string().nullable(),
        notes: z.string().nullable(),
      })
    )
    .describe("Existing approval stamps or action codes found in the document"),

  drsItems: z
    .array(
      z.object({
        itemNumber: z.number(),
        reviewerComment: z.string(),
        contractorResponse: z.string(),
        status: z
          .enum(["complied", "not_complied", "excluded", "noted", "unknown"])
          .describe("Compliance status"),
      })
    )
    .describe("Document Review Sheet items if present"),

  certificates: z
    .array(
      z.object({
        type: z.string().describe("Certificate type (fire test, mill cert, QCDD, etc.)"),
        issuer: z.string().nullable(),
        reference: z.string().nullable(),
        validUntil: z.string().nullable(),
      })
    )
    .describe("Certificates found in the document"),

  testResults: z
    .array(
      z.object({
        test: z.string(),
        result: z.string(),
        requirement: z.string().nullable(),
        pass: z.boolean().nullable(),
      })
    )
    .describe("Test results found in the document"),

  keyFindings: z
    .array(z.string())
    .describe("Important observations about the submittal content"),

  suggestedQCSQueries: z
    .array(z.string())
    .describe(
      "Specific search queries for retrieving relevant QCS 2024 sections"
    ),

  pageCount: z.number(),
  hasArabicText: z.boolean(),
  hasTables: z.boolean(),
});

export type SubmittalAnalysis = z.infer<typeof SubmittalAnalysisSchema>;

export async function analyzeSubmittalContent(
  extraction: PDFExtractionResult
): Promise<SubmittalAnalysis> {
  // Build multi-modal content: text + page images
  // AI SDK v6 uses FilePart ({ type: "file", data, mediaType }) for images, not ImagePart
  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: string; mediaType: string }
  > = [];

  // Add extracted text
  contentParts.push({
    type: "text",
    text: `DOCUMENT: "${extraction.filename ?? "submittal.pdf"}" (${extraction.totalPages} pages)\n\nEXTRACTED TEXT:\n${extraction.rawText}`,
  });

  // For scanned PDFs, send the raw PDF directly to GPT-4o (native PDF support).
  // For text-based PDFs, send rendered page images for visual context.
  if (extraction.isScanned && extraction.pdfBase64) {
    contentParts.push({
      type: "text",
      text: `\n[Attached: Full PDF document for visual analysis — ${extraction.totalPages} pages]`,
    });
    contentParts.push({
      type: "file",
      data: extraction.pdfBase64,
      mediaType: "application/pdf",
    });
  } else {
    for (const page of extraction.pages) {
      if (page.imageDataUrl) {
        contentParts.push({
          type: "text",
          text: `\n--- PAGE ${page.pageNumber} IMAGE (visual scan) ---`,
        });
        const mediaType = page.imageMediaType ?? "image/png";
        const base64Data = page.imageDataUrl.replace(
          /^data:image\/[a-z]+;base64,/,
          ""
        );
        contentParts.push({
          type: "file",
          data: base64Data,
          mediaType,
        });
      }
    }
  }

  const { object } = await generateObject({
    model: openai("gpt-4o"),
    schema: SubmittalAnalysisSchema,
    system: ANALYSIS_PROMPT,
    messages: [{ role: "user", content: contentParts }],
  });

  return object;
}
