import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { searchQCS, hybridSearch } from "@/lib/vector-store";
import { extractPDF, type PDFExtractionResult } from "@/lib/pdf-extract";
import { analyzeSubmittalContent } from "@/lib/submittal-analyzer";

export const maxDuration = 120;

type RagMode = "vector" | "graph";

const SYSTEM_PROMPT = `You are a Construction Submittal Review Agent specializing in Qatar Construction Specifications (QCS 2024). Your role is to review construction submittals and determine whether they comply with QCS 2024 requirements.

## Understanding Real-World Submittals
Construction submittals are multi-page documents that typically contain:
- **Cover Sheet / MAR Form**: Material Submittal Approval form with project info, contractor, manufacturer, supplier, and action code
- **Document Review Sheet (DRS)**: Table with reviewer comments, contractor responses, and compliance status (Complied/Not Complied/Excluded/Noted)
- **Pre-Qualification Documents**: Contractor/supplier qualification forms
- **Test Certificates**: Mill certificates, lab test reports, fire resistance test results
- **Third-Party Certifications**: Intertek, UL, QCDD (Qatar Civil Defence) product approvals
- **Technical Data Sheets**: Manufacturer product specifications
- **Approval Stamps**: Previous review stamps with action codes (A=Approved, B=Approved as Noted, C=Revise & Resubmit, D=Rejected)
- **Arabic Text**: QCDD certificates, project names, authority approvals (common in Qatar)

IMPORTANT: Even if a submittal shows existing approval stamps or action codes from previous reviews, you MUST still perform a fresh, independent review against QCS 2024 requirements. Note existing approvals in your analysis but base your verdict on your own assessment.

## Your Process:
1. When a user uploads a PDF submittal, FIRST call the analyzeSubmittal tool to extract structured information from the document.
2. Review the analysis results to understand the document type, materials, standards cited, test results, and certificates present.
3. **ALWAYS** use the retrieveQCSSpecs tool to search for relevant QCS sections — this step is MANDATORY, even if the analysis is sparse or the document is image-based. Use the suggestedQCSQueries from the analysis as starting points. Make MULTIPLE searches if the submittal covers different materials or requirements.
4. Compare the submittal content against the retrieved QCS specifications.
5. Provide a structured review with a clear verdict.

For text-only submittals (no PDF uploaded), skip step 1 and proceed directly to searching QCS specs.

**CRITICAL**: Even for scanned/image-based PDFs where text extraction is limited, you MUST:
- Carefully examine ALL page images provided to you — they contain the actual document content
- Identify materials, standards, test results, and certificates from the visual content in page images
- Use ANY identifiable information (project name, material type, document title) to search QCS specs
- NEVER skip the retrieveQCSSpecs tool — always search for at least the general topic area (e.g., "general submittal requirements", "material submittal documentation requirements")
- If you cannot identify specific materials from images, search for broad QCS requirements about submittal documentation, testing, and certification

## Response Format:
Always structure your review response with these sections:

### VERDICT
State one of: **APPROVED**, **REJECTED**, or **NEEDS REVISION**

### DOCUMENT OVERVIEW
Brief description of the submittal type, contractor, project, and materials covered. Note any existing approval status found in the document.

### SUMMARY
A brief 2-3 sentence summary of the review findings.

### DETAILED ANALYSIS
For each relevant specification requirement:
- State the QCS requirement (with section/clause reference)
- State whether the submittal meets, fails, or partially meets the requirement
- Explain why, referencing specific values, test results, or certificates from the submittal

### CITATIONS
List all QCS sections referenced in your analysis with their section numbers, clause numbers, and page numbers.

### RECOMMENDATIONS
If rejected or needs revision, provide specific actionable recommendations.

## Important Rules:
- When a PDF is uploaded, ALWAYS call analyzeSubmittal first to properly parse the document
- ALWAYS use the retrieveQCSSpecs tool before making any determination
- Make MULTIPLE QCS searches if different materials or aspects need checking
- ALWAYS cite specific QCS sections and clause numbers
- Reference specific test values, properties, and standards from the submittal in your analysis
- If tables or data are present, compare numerical values against QCS requirements
- If the submittal lacks information needed for a full review, note what additional information would be needed
- Consider all relevant aspects: materials, methods, standards compliance, testing requirements, certifications
- If you are unsure about a requirement, say so rather than guessing`;

/**
 * Replace raw PDF file parts in model messages with extracted text + page images.
 */
function injectPDFContent(
  modelMessages: ModelMessage[],
  extraction: PDFExtractionResult
): ModelMessage[] {
  const lastUserIdx = modelMessages.findLastIndex((m) => m.role === "user");
  if (lastUserIdx === -1) return modelMessages;

  const userMsg = modelMessages[lastUserIdx];
  if (userMsg.role !== "user") return modelMessages;

  // Content may be a string or parts array
  const contentArray = typeof userMsg.content === "string"
    ? [{ type: "text" as const, text: userMsg.content }]
    : userMsg.content;

  const newContent: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string }> = [];

  for (const part of contentArray) {
    if (
      typeof part === "object" &&
      part.type === "file" &&
      "mediaType" in part &&
      (part as any).mediaType === "application/pdf"
    ) {
      // Replace raw PDF with extracted text
      newContent.push({
        type: "text",
        text:
          `[PDF Document: "${extraction.filename ?? "submittal.pdf"}" — ${extraction.totalPages} pages]\n\n` +
          `EXTRACTED TEXT:\n${extraction.rawText}`,
      });

      // Add page images as FilePart (AI SDK v6 uses type:"file" with mediaType for images)
      for (const page of extraction.pages) {
        if (page.imageDataUrl) {
          newContent.push({
            type: "text",
            text: `\n[Page ${page.pageNumber} image scan:]`,
          });
          // Extract base64 data from data URL (strip "data:image/png;base64," prefix)
          const base64Data = page.imageDataUrl.replace(
            /^data:image\/png;base64,/,
            ""
          );
          newContent.push({
            type: "file",
            data: base64Data,
            mediaType: "image/png",
          });
        }
      }
    } else {
      newContent.push(part as any);
    }
  }

  const updated = [...modelMessages];
  updated[lastUserIdx] = { ...userMsg, content: newContent as any };
  return updated;
}

export async function POST(req: Request) {
  const {
    messages,
    ragMode = "vector",
  }: { messages: UIMessage[]; ragMode?: RagMode } = await req.json();

  const useGraphRAG = ragMode === "graph";

  // --- Detect and preprocess PDF attachments ---
  let pdfExtraction: PDFExtractionResult | null = null;
  let pdfExtractionError: string | null = null;
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === "user") {
    for (const part of lastMessage.parts) {
      if (
        part.type === "file" &&
        "mediaType" in part &&
        (part as any).mediaType === "application/pdf"
      ) {
        try {
          pdfExtraction = await extractPDF((part as any).url, {
            maxImagePages: 15,
            imageScale: 2.0,
            filename: (part as any).filename,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("PDF extraction failed:", msg, err);
          pdfExtractionError = msg;
        }
        break; // Process first PDF only
      }
    }
  }

  // --- Convert messages and inject extracted content ---
  let modelMessages = await convertToModelMessages(messages);

  if (pdfExtraction) {
    modelMessages = injectPDFContent(modelMessages, pdfExtraction);

    // Debug: log what content types are in the last user message
    const lastUser = modelMessages.findLast((m) => m.role === "user");
    if (lastUser && Array.isArray(lastUser.content)) {
      const summary = lastUser.content.map((p: any) => {
        if (p.type === "text") return `text(${p.text.length} chars)`;
        if (p.type === "file") return `file(${p.mediaType}, ${typeof p.data === "string" ? `${(p.data.length / 1024).toFixed(0)}KB` : typeof p.data})`;
        return `unknown(${p.type})`;
      });
      console.log("[PDF inject] content parts:", summary.join(", "));
    }
  }

  // --- Stream with enhanced tools ---
  const result = streamText({
    model: openai("gpt-4o"),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(8),
    tools: {
      analyzeSubmittal: tool({
        description:
          "Analyze an uploaded PDF submittal document to extract structured information. " +
          "Call this FIRST when a PDF has been uploaded, before searching QCS specs. " +
          "Returns document type, materials, standards, test results, certificates, " +
          "existing approval status, and suggested QCS search queries.",
        inputSchema: z.object({
          focus: z
            .string()
            .optional()
            .describe(
              "Optional focus area for analysis (e.g., 'fire rated doors', 'steel properties')"
            ),
        }),
        execute: async () => {
          if (!pdfExtraction) {
            if (pdfExtractionError) {
              return {
                error: `PDF extraction failed: ${pdfExtractionError}. Please inform the user about this technical issue and suggest they try again.`,
              };
            }
            return { error: "No PDF document was uploaded with this message." };
          }
          return await analyzeSubmittalContent(pdfExtraction);
        },
      }),

      retrieveQCSSpecs: tool({
        description:
          "Search the QCS 2024 (Qatar Construction Specifications) knowledge base for relevant specifications, requirements, and standards. Use this tool to find the specific QCS sections that apply to the construction submittal being reviewed.",
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "The search query describing what specifications to find. Be specific about the material, method, or requirement you are looking for."
            ),
        }),
        execute: async ({ query }) => {
          const results = useGraphRAG
            ? await hybridSearch(query, 8, 2, 12)
            : await searchQCS(query, 8);

          return results.map((r) => ({
            reference: `QCS 2024 Section ${r.sectionNumber}: ${r.sectionTitle}, Part ${r.partNumber}: ${r.partTitle}, Clause ${r.clauseNumber}: ${r.clauseTitle} (Pages ${r.pageStart}-${r.pageEnd})`,
            content: r.content,
            relevanceScore: r.score,
            source: r.score < 0.6 ? "graph" : "vector",
          }));
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
