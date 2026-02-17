import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { google, type GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { z } from "zod";
import { searchQCS, hybridSearch, type QCSSearchResult } from "@/lib/vector-store";
import { extractPDF, type PDFExtractionResult } from "@/lib/pdf-extract";
import {
  analyzeSubmittalContent,
  type SubmittalAnalysis,
} from "@/lib/submittal-analyzer";

export const maxDuration = 120;

type RagMode = "vector" | "graph";
const MAX_REFS_PER_QUERY = 6;
const MAX_GRAPH_REFS_PER_QUERY = 2;
const MIN_CONTENT_CHARS = 80;
const MAX_TOTAL_REFS = 6;
const MAX_TOTAL_GRAPH_REFS = 4;
const MAX_QUERIES = 8;
const RESPONSE_CHUNK_SIZE = 140;
const RESPONSE_CHUNK_DELAY_MS = 18;
const REVIEW_STAGE_LABELS = {
  uploaded: "Upload received",
  extracting: "Extracting document content...",
  analyzing: "Analyzing submittal structure...",
  retrieving: "Retrieving relevant QCS sections...",
  drafting: "Drafting compliance review...",
} as const;

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
- If you are unsure about a requirement, say so rather than guessing
- **NEVER list raw retrieved sources/references in your text response.** The retrieved QCS chunks are displayed automatically in the UI as collapsible sources. Your text response should ONLY contain the structured review (VERDICT, DOCUMENT OVERVIEW, SUMMARY, DETAILED ANALYSIS, CITATIONS, RECOMMENDATIONS). Do NOT echo, list, or enumerate the tool results before your analysis.
- **Hard verdict rule:** Do NOT return APPROVED unless all critical requirements are explicitly evidenced in the submittal itself. If evidence is missing, return NEEDS REVISION.
- If the submittal references QCS 2014 (or any pre-2024 version) and does not explicitly confirm QCS 2024 compliance, the verdict must be NEEDS REVISION.
- Do not mark a requirement as "Meets" based on intent, future submittals, assumptions, or implicit statements. Mark as PARTIALLY MEETS or FAILS when direct evidence is absent.
- Keep the CITATIONS section concise and relevant (max 12 citations) and include only references you directly used in the analysis.`;

type RetrievedRef = {
  reference: string;
  content: string;
  relevanceScore: number;
  source: "vector" | "graph";
};

type ScopeSignal = {
  label: string;
  pattern: RegExp;
};

const NON_CONSTRUCTION_SIGNALS: ScopeSignal[] = [
  { label: "internship", pattern: /\binternship\b/i },
  { label: "employment proof", pattern: /\bemployment proof\b/i },
  { label: "confidentiality agreement", pattern: /\bconfidentiality agreement\b/i },
  { label: "academic transcript", pattern: /\btranscript|gpa|semester|student id\b/i },
  { label: "curriculum vitae", pattern: /\bcurriculum vitae|resume|cv\b/i },
  { label: "banking document", pattern: /\bbank statement|iban|account number|swift\b/i },
  { label: "medical record", pattern: /\bmedical report|diagnosis|patient|hospital\b/i },
  { label: "identity document", pattern: /\bpassport|national id|identity card|visa\b/i },
  { label: "legal affidavit", pattern: /\baffidavit|notary|power of attorney\b/i },
  { label: "student", pattern: /\bstudent\b/i },
  { label: "university", pattern: /\buniversity|college\b/i },
  { label: "human resources", pattern: /\bhuman resources|hr\b/i },
];

const CONSTRUCTION_SIGNALS: ScopeSignal[] = [
  { label: "construction submittal", pattern: /\bsubmittal\b/i },
  { label: "construction scope", pattern: /\bconstruction|civil|structural|architectural\b/i },
  { label: "method statement", pattern: /\bmethod statement\b/i },
  { label: "shop drawing", pattern: /\bshop drawing\b/i },
  { label: "material data", pattern: /\bmaterial submittal|product data|technical data sheet\b/i },
  { label: "construction testing", pattern: /\btest report|mill certificate|mix design\b/i },
  { label: "construction standards", pattern: /\bqcs|astm|bs|en|iso|nfpa\b/i },
  { label: "construction approvals", pattern: /\bqcdd|qcd|civil defence\b/i },
];

const CONSTRUCTION_KEYWORD_PATTERN =
  /\b(submittal|construction|civil|architectural|structural|method statement|shop drawing|product data|technical data sheet|concrete|cement|steel|masonry|mortar|asphalt|aggregate|pipe|valve|cable|earthing|fire|life safety|qcdd|qcd|mix design|test report|mill certificate|qcs|astm|nfpa|bs|en|iso)\b/i;

function cleanClauseTitle(title: string): string {
  return title.replace(/\s*\.{3,}\s*\d+\s*$/, "").trim();
}

function collectSignalMatches(text: string, signals: ScopeSignal[]): string[] {
  return signals
    .filter((signal) => signal.pattern.test(text))
    .map((signal) => signal.label);
}

function assessDocumentScope(
  analysis: SubmittalAnalysis | null,
  rawText: string
): {
  isOutOfScope: boolean;
  nonConstructionSignals: string[];
  constructionSignals: string[];
  hasStructuredConstructionEvidence: boolean;
  outOfScopeScore: number;
  inScopeScore: number;
} {
  const materialsText = analysis
    ? analysis.materials
        .map((m) =>
          [m.name, m.manufacturer ?? "", m.supplier ?? "", m.standard ?? ""].join(" ")
        )
        .join(" ")
    : "";
  const certificatesText = analysis
    ? analysis.certificates
        .map((c) => [c.type, c.issuer ?? "", c.reference ?? ""].join(" "))
        .join(" ")
    : "";
  const testsText = analysis
    ? analysis.testResults
        .map((t) => [t.test, t.result, t.requirement ?? ""].join(" "))
        .join(" ")
    : "";

  const analysisText = analysis
    ? [
        analysis.title,
        analysis.project ?? "",
        analysis.contractor ?? "",
        analysis.keyFindings.join(" "),
        analysis.standardsCited.join(" "),
        materialsText,
        certificatesText,
        testsText,
      ].join(" ")
    : "";
  const combinedText = `${analysisText}\n${rawText.slice(0, 6000)}`;

  const nonConstructionSignals = collectSignalMatches(
    combinedText,
    NON_CONSTRUCTION_SIGNALS
  );
  const constructionSignals = collectSignalMatches(
    combinedText,
    CONSTRUCTION_SIGNALS
  );

  const hasConstructionStandards = Boolean(
    analysis?.standardsCited.some((s) => CONSTRUCTION_KEYWORD_PATTERN.test(s))
  );
  const hasConstructionMaterials = Boolean(
    analysis?.materials.some((m) =>
      CONSTRUCTION_KEYWORD_PATTERN.test(
        `${m.name} ${m.standard ?? ""} ${m.properties.map((p) => `${p.key} ${p.value}`).join(" ")}`
      )
    )
  );
  const hasConstructionCertificates = Boolean(
    analysis?.certificates.some((c) =>
      CONSTRUCTION_KEYWORD_PATTERN.test(
        `${c.type} ${c.issuer ?? ""} ${c.reference ?? ""}`
      )
    )
  );
  const hasConstructionTests = Boolean(
    analysis?.testResults.some((t) =>
      CONSTRUCTION_KEYWORD_PATTERN.test(`${t.test} ${t.result} ${t.requirement ?? ""}`)
    )
  );
  const hasConstructionInRawText = CONSTRUCTION_KEYWORD_PATTERN.test(combinedText);
  const knownConstructionDocType = Boolean(
    analysis && analysis.documentType !== "other"
  );

  const hasStructuredConstructionEvidence = Boolean(
    analysis &&
      (
        hasConstructionMaterials ||
        hasConstructionTests ||
        hasConstructionCertificates ||
        hasConstructionStandards ||
        analysis.drsItems.length > 0
      )
  );

  const titleLooksNonConstruction = Boolean(
    analysis &&
      /\binternship|employment|cv|resume|confidentiality|passport|visa|bank statement|medical\b/i.test(
        analysis.title
      )
  );
  const otherType = analysis?.documentType === "other";

  const outOfScopeScore =
    (otherType ? 2 : 0) +
    (!knownConstructionDocType ? 1 : 0) +
    (!hasStructuredConstructionEvidence ? 2 : 0) +
    (nonConstructionSignals.length >= 1 ? 2 : 0) +
    (nonConstructionSignals.length >= 3 ? 1 : 0) +
    (!hasConstructionInRawText ? 1 : 0);

  const inScopeScore =
    (knownConstructionDocType ? 2 : 0) +
    (hasStructuredConstructionEvidence ? 4 : 0) +
    (constructionSignals.length >= 1 ? 2 : 0) +
    (constructionSignals.length >= 3 ? 1 : 0) +
    (hasConstructionInRawText ? 1 : 0);

  const isOutOfScope =
    (
      (titleLooksNonConstruction && !hasStructuredConstructionEvidence) ||
      (outOfScopeScore >= 5 && outOfScopeScore > inScopeScore + 1)
    );

  return {
    isOutOfScope,
    nonConstructionSignals,
    constructionSignals,
    hasStructuredConstructionEvidence,
    outOfScopeScore,
    inScopeScore,
  };
}

function isOutOfScopeReviewText(text: string): boolean {
  const hasRejectedVerdict =
    /###\s*VERDICT[\s\S]{0,80}\bREJECTED\b/i.test(text) || /\bREJECTED\b/i.test(text);
  if (!hasRejectedVerdict) return false;

  return /\bout[-\s]of[-\s]scope\b|\boutside the scope\b|\bnot a construction submittal\b|\bunrelated to construction\b|\bqcs .* not applicable\b|\bnon-construction document\b/i.test(
    text
  );
}

function chunkText(text: string, chunkSize: number = RESPONSE_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeReviewStage(
  writer: any,
  id: keyof typeof REVIEW_STAGE_LABELS
): void {
  writer.write({
    type: "data-review-stage",
    data: {
      id,
      label: REVIEW_STAGE_LABELS[id],
      timestamp: Date.now(),
    },
  } as any);
}

async function writeReportToStream(
  writer: any,
  text: string,
  refs: RetrievedRef[]
): Promise<void> {
  refs.forEach((ref, idx) => {
    writer.write({
      type: "source-url",
      sourceId: `${ref.source}-${idx + 1}`,
      url: "#",
      title: ref.reference,
    } as any);
  });

  writer.write({ type: "text-start", id: "text-1" } as any);
  for (const delta of chunkText(text)) {
    writer.write({ type: "text-delta", id: "text-1", delta } as any);
    if (RESPONSE_CHUNK_DELAY_MS > 0) {
      await sleep(RESPONSE_CHUNK_DELAY_MS);
    }
  }
  writer.write({ type: "text-end", id: "text-1" } as any);
}

function buildCitationSection(refs: RetrievedRef[]): string {
  if (refs.length === 0) return "";
  const lines = refs.map((r) => `- ${r.reference}`);
  return `### CITATIONS\n${lines.join("\n")}`;
}

function stripGeneratedCitationSection(text: string): string {
  const withoutCitations = text.split(/\n###\s*CITATIONS\b/i)[0] ?? text;
  return withoutCitations
    .replace(
      /^Used \d+ QCS sections[^\n]*\n(?:QCS 2024 Section.*\n|graph\s*\n)*/i,
      ""
    )
    .trim();
}

function buildReference(r: QCSSearchResult): RetrievedRef {
  const title = cleanClauseTitle(r.clauseTitle);
  return {
    reference:
      `QCS 2024 Section ${r.sectionNumber}: ${r.sectionTitle}, ` +
      `Part ${r.partNumber}: ${r.partTitle}, ` +
      `Clause ${r.clauseNumber}: ${title} (Pages ${r.pageStart}-${r.pageEnd})`,
    content: r.content,
    relevanceScore: r.score,
    source: r.isGraph ? "graph" : "vector",
  };
}

function filterResults(results: QCSSearchResult[]): QCSSearchResult[] {
  return results.filter((r) => {
    if (!r.clauseNumber || r.clauseNumber.trim() === "") return false;
    if (!r.content || r.content.trim().length < MIN_CONTENT_CHARS) return false;
    if (/\.{3,}\s*\d+\s*$/.test(r.clauseTitle)) return false;
    if (
      /^(?:scope|introduction|references)$/i.test(r.clauseTitle.trim()) &&
      r.isGraph
    ) {
      return false;
    }
    if (
      /(company name|inspection date|plant location|plant no\/s|plant manufacturer|plant id no|approval certificate no|contact a plant|yes\s*☐\s*no\s*☐)/i.test(
        r.clauseTitle
      )
    ) {
      return false;
    }
    return true;
  });
}

function rankAndSelect(
  rows: QCSSearchResult[],
  maxTotal: number,
  maxGraph: number
): RetrievedRef[] {
  const byClause = new Map<string, QCSSearchResult>();
  for (const row of rows) {
    const key = `${row.sectionNumber}|${row.partNumber}|${row.clauseNumber}`;
    const existing = byClause.get(key);
    if (!existing) {
      byClause.set(key, row);
      continue;
    }
    const preferNew =
      (existing.isGraph && !row.isGraph) ||
      (existing.isGraph === row.isGraph && row.score > existing.score);
    if (preferNew) byClause.set(key, row);
  }

  const deduped = Array.from(byClause.values()).sort((a, b) => {
    if (a.isGraph !== b.isGraph) return a.isGraph ? 1 : -1;
    return b.score - a.score;
  });

  const selected: QCSSearchResult[] = [];
  let graphCount = 0;
  for (const row of deduped) {
    if (row.isGraph) {
      if (graphCount >= maxGraph) continue;
      graphCount += 1;
    }
    selected.push(row);
    if (selected.length >= maxTotal) break;
  }

  return selected.map(buildReference);
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildDeterministicQueries(analysis: SubmittalAnalysis | null): string[] {
  const baseline = [
    "method statement submittal requirements qcs 2024",
    "qcs 2024 fire life safety product approval qcd qcdd requirements",
    "qcs 2024 concrete mix design and submittal requirements",
    "qcs 2024 earthworks compaction and field density testing",
    "qcs 2024 masonry block work and mortar requirements",
    "qcs 2024 quality assurance inspection testing requirements",
  ];
  const suggested = analysis?.suggestedQCSQueries ?? [];
  const merged = [...suggested, ...baseline].filter((q) => q?.trim().length > 0);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of merged) {
    const key = normalizeQuery(q);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(q.trim());
    if (deduped.length >= MAX_QUERIES) break;
  }

  return deduped;
}

function detectCriticalReasons(analysis: SubmittalAnalysis | null): string[] {
  if (!analysis) return [];

  const reasons: string[] = [];
  const standards = analysis.standardsCited.join(" ");
  const findings = analysis.keyFindings.join(" ");
  const projectText = `${analysis.title} ${analysis.project ?? ""} ${analysis.materials.map((m) => m.name).join(" ")}`.toLowerCase();
  const combined = `${standards} ${findings}`.toLowerCase();

  const referencesQcs2014 = /q\.?\s*c\.?\s*s\.?\s*2014|qcs\s*2014/i.test(
    `${standards} ${findings} ${analysis.title}`
  );
  const confirmsQcs2024 = /qcs\s*2024/i.test(combined);

  if (referencesQcs2014 && !confirmsQcs2024) {
    reasons.push(
      "The submittal references QCS 2014 and does not explicitly confirm full compliance with QCS 2024."
    );
  }

  const fireScope =
    /fire|life safety|qcdd|qcd|alarm|firefighting|passive fire/i.test(
      projectText
    );
  const hasQcdEvidence = analysis.certificates.some((c) =>
    /qcd|qcdd|civil defence/i.test(
      `${c.type} ${c.issuer ?? ""} ${c.reference ?? ""}`
    )
  );
  if (fireScope && !hasQcdEvidence) {
    reasons.push(
      "Fire life safety scope is present, but explicit QCD/QCDD approval evidence for products/systems is not provided in this submittal."
    );
  }

  return reasons;
}

function streamStaticMarkdown(
  text: string,
  refs: RetrievedRef[],
  originalMessages?: UIMessage[]
): Response {
  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      writer.write({ type: "start" } as any);
      writer.write({ type: "start-step" } as any);
      await writeReportToStream(writer, text, refs);
      writer.write({ type: "finish-step" } as any);
      writer.write({ type: "finish", finishReason: "stop" } as any);
    },
  });

  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  const {
    messages,
    ragMode = "vector",
  }: { messages: UIMessage[]; ragMode?: RagMode } = await req.json();

  const useGraphRAG = ragMode === "graph";

  // --- Detect PDF attachment (deterministic review path) ---
  let hadPdfAttachment = false;
  let pdfAttachment: { url: string; filename?: string } | null = null;
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === "user") {
    for (const part of lastMessage.parts) {
      if (
        part.type === "file" &&
        "mediaType" in part &&
        (part as any).mediaType === "application/pdf"
      ) {
        hadPdfAttachment = true;
        pdfAttachment = {
          url: (part as any).url,
          filename: (part as any).filename,
        };
        break; // Process first PDF only
      }
    }
  }

  // --- Deterministic fail-closed path for PDF reviews (with real progress stages) ---
  if (hadPdfAttachment && pdfAttachment) {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        writer.write({ type: "start" } as any);
        writer.write({ type: "start-step" } as any);
        writeReviewStage(writer, "uploaded");

        try {
          writeReviewStage(writer, "extracting");

          let pdfExtraction: PDFExtractionResult;
          try {
            pdfExtraction = await extractPDF(pdfAttachment.url, {
              filename: pdfAttachment.filename,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("PDF extraction failed:", msg, err);
            writeReviewStage(writer, "drafting");

            const failure = `### VERDICT
NEEDS REVISION

### DOCUMENT OVERVIEW
The PDF could not be processed for grounded review.

### SUMMARY
This response is fail-closed: a compliance verdict cannot be approved without grounded evidence from the uploaded document and QCS retrieval.

### DETAILED ANALYSIS
- PDF extraction failed, so document evidence could not be reliably analyzed.
- A grounded compliance decision requires extracted submittal evidence and retrieved QCS clauses.

### RECOMMENDATIONS
- Re-upload the PDF and retry the review.
- Ensure the document is readable and not corrupted.
- If the issue persists, provide a text-based export alongside the PDF.`;

            await writeReportToStream(writer, failure, []);
            writer.write({ type: "finish-step" } as any);
            writer.write({ type: "finish", finishReason: "stop" } as any);
            return;
          }

          writeReviewStage(writer, "analyzing");
          let analysis: SubmittalAnalysis | null = null;
          try {
            analysis = await analyzeSubmittalContent(pdfExtraction);
          } catch (err) {
            console.error("Deterministic analysis failed:", err);
          }

          const scopeAssessment = assessDocumentScope(
            analysis,
            pdfExtraction.rawText ?? ""
          );
          if (scopeAssessment.isOutOfScope) {
            writeReviewStage(writer, "drafting");
            const signalSummary =
              scopeAssessment.nonConstructionSignals.length > 0
                ? scopeAssessment.nonConstructionSignals.join(", ")
                : "non-construction indicators";
            const outOfScope = `### VERDICT
REJECTED

### DOCUMENT OVERVIEW
The uploaded file appears to be a non-construction document and is outside the scope of QCS submittal compliance review.

### SUMMARY
The document is not a construction submittal, so QCS clause-by-clause compliance checking is not applicable. The request is rejected as out-of-scope for this reviewer.

### DETAILED ANALYSIS
1. Document signals indicate non-construction context (${signalSummary}).
2. The extracted content does not provide structured construction-submittal evidence (materials, test reports, certificates, or DRS items).
3. Because the file is out-of-scope, QCS clause citations are intentionally omitted.
4. A standards-based compliance review can proceed only after a relevant construction submittal is uploaded.

### RECOMMENDATIONS
- Upload a construction-related document (for example: material submittal, method statement, mix design, test report, shop drawing, or product certificate).
- If this upload was accidental, replace it with the intended project submittal PDF.`;
            await writeReportToStream(writer, outOfScope, []);
            writer.write({ type: "finish-step" } as any);
            writer.write({ type: "finish", finishReason: "stop" } as any);
            return;
          }

          writeReviewStage(writer, "retrieving");
          const queries = buildDeterministicQueries(analysis);
          const rawResultsNested = await Promise.all(
            queries.map(async (query) => {
              try {
                return useGraphRAG
                  ? await hybridSearch(query, 8, 2, 12)
                  : await searchQCS(query, 8);
              } catch (err) {
                console.warn("QCS retrieval failed for query:", query, err);
                return [] as QCSSearchResult[];
              }
            })
          );
          const filtered = filterResults(rawResultsNested.flat());
          const refs = rankAndSelect(filtered, MAX_TOTAL_REFS, MAX_TOTAL_GRAPH_REFS);
          const criticalReasons = detectCriticalReasons(analysis);

          writeReviewStage(writer, "drafting");

          if (refs.length === 0) {
            const failClosed = `### VERDICT
NEEDS REVISION

### DOCUMENT OVERVIEW
The submitted method statement could not be grounded to valid QCS references after deterministic retrieval.

### SUMMARY
This is a fail-closed result: because no validated references were retrieved, the system cannot issue an evidence-backed approval.

### DETAILED ANALYSIS
- Retrieval produced zero validated QCS references after quality filters.
- Without grounded citations, any detailed compliance conclusion would risk fabrication.
${criticalReasons.length > 0 ? `- Critical gap(s) detected:\n${criticalReasons.map((r) => `  - ${r}`).join("\n")}` : ""}

### RECOMMENDATIONS
- Re-run with a clearer PDF/OCR source if available.
- Provide explicit QCS 2024 alignment statements in the submittal.
- Provide required fire-life-safety approvals/certifications where applicable.`;
            await writeReportToStream(writer, failClosed, []);
            writer.write({ type: "finish-step" } as any);
            writer.write({ type: "finish", finishReason: "stop" } as any);
            return;
          }

          const evidence = refs
            .map(
              (ref, i) =>
                `[C${i + 1}] ${ref.reference}\nExcerpt: ${ref.content
                  .replace(/\s+/g, " ")
                  .slice(0, 420)}`
            )
            .join("\n\n");

          const forcedVerdictBlock =
            criticalReasons.length > 0
              ? `Mandatory verdict: NEEDS REVISION\nReasons:\n${criticalReasons
                  .map((r) => `- ${r}`)
                  .join("\n")}`
              : "Use the evidence to determine verdict. APPROVED is allowed only when explicit evidence for all critical requirements is present.";

          const analysisSummary = analysis
            ? JSON.stringify(
                {
                  documentType: analysis.documentType,
                  title: analysis.title,
                  project: analysis.project,
                  contractor: analysis.contractor,
                  standardsCited: analysis.standardsCited,
                  keyFindings: analysis.keyFindings,
                },
                null,
                2
              )
            : "{ \"note\": \"analysis unavailable\" }";

          const reportPrompt = `You are preparing a grounded construction compliance review.

${forcedVerdictBlock}

Rules:
- Use ONLY the evidence provided below.
- Do NOT fabricate clauses or page numbers.
- Do NOT include a CITATIONS section (it is appended separately).
- Keep output concise and structured.
- Use at most 6 citations total. Do not cite unrelated sections.
- Do not mention internal labels like "Submittal analysis snapshot" in the final response.
- When referring to document evidence, use user-facing phrasing such as "As stated in the submitted method statement".
- Sections required exactly in this order:
  1) ### VERDICT
  2) ### DOCUMENT OVERVIEW
  3) ### SUMMARY
  4) ### DETAILED ANALYSIS
  5) ### RECOMMENDATIONS
- For DETAILED ANALYSIS, include 4-6 numbered checks and cite evidence inline like [C1], [C3].

Document evidence extracted from the submitted submittal:
${analysisSummary}

Validated QCS evidence:
${evidence}`;

          // Write source citations to stream (displayed as collapsible UI)
          refs.forEach((ref, idx) => {
            writer.write({
              type: "source-url",
              sourceId: `${ref.source}-${idx + 1}`,
              url: "#",
              title: ref.reference,
            } as any);
          });

          let textStarted = false;
          let generatedReviewText = "";
          try {
            const reportResult = streamText({
              model: google("gemini-2.5-flash"),
              temperature: 0,
              prompt: reportPrompt,
              providerOptions: {
                google: {
                  thinkingConfig: {
                    includeThoughts: true,
                    thinkingBudget: 10240,
                  },
                } satisfies GoogleGenerativeAIProviderOptions,
              },
            });

            for await (const part of reportResult.fullStream) {
              if (part.type === "reasoning-start") {
                writer.write({ type: "reasoning-start", id: part.id } as any);
              } else if (part.type === "reasoning-delta") {
                writer.write({ type: "reasoning-delta", id: part.id, delta: part.text } as any);
              } else if (part.type === "reasoning-end") {
                writer.write({ type: "reasoning-end", id: part.id } as any);
              } else if (part.type === "text-delta") {
                if (!textStarted) {
                  writer.write({ type: "text-start", id: "text-1" } as any);
                  textStarted = true;
                }
                generatedReviewText += part.text;
                writer.write({ type: "text-delta", id: "text-1", delta: part.text } as any);
              }
            }
          } catch (err) {
            console.error("Report generation failed:", err);
            const fallbackBody = `### VERDICT
NEEDS REVISION

### DOCUMENT OVERVIEW
This submittal is a method statement and requires evidence-backed alignment with QCS 2024.

### SUMMARY
The review could not complete full narrative generation, but grounded evidence indicates revision is required before approval.

### DETAILED ANALYSIS
1. The submittal must be aligned to QCS 2024 requirements.
2. Fire life safety scope requires explicit approval evidence for relevant products/systems.
3. Method statement claims should be tied to measurable QA/QC criteria and cited clauses.
4. Existing historical approval stamps do not replace current-cycle compliance review.

### RECOMMENDATIONS
- Update all legacy references to QCS 2024.
- Provide explicit product approvals/certifications where required.
- Re-submit with clear clause-level compliance statements.`;
            generatedReviewText += fallbackBody;
            if (!textStarted) {
              writer.write({ type: "text-start", id: "text-1" } as any);
              textStarted = true;
            }
            writer.write({ type: "text-delta", id: "text-1", delta: fallbackBody } as any);
          }

          if (!textStarted) {
            writer.write({ type: "text-start", id: "text-1" } as any);
          }

          // Append citation section after streamed report
          const citationText = isOutOfScopeReviewText(generatedReviewText)
            ? ""
            : buildCitationSection(refs);
          if (citationText) {
            writer.write({ type: "text-delta", id: "text-1", delta: `\n\n${citationText}` } as any);
          }

          writer.write({ type: "text-end", id: "text-1" } as any);
          writer.write({ type: "finish-step" } as any);
          writer.write({ type: "finish", finishReason: "stop" } as any);
        } catch (err) {
          console.error("Deterministic PDF review stream failed:", err);
          writeReviewStage(writer, "drafting");
          const fallback = `### VERDICT
NEEDS REVISION

### DOCUMENT OVERVIEW
The review pipeline encountered an internal error.

### SUMMARY
This response is fail-closed to avoid ungrounded approvals.

### DETAILED ANALYSIS
- The deterministic review pipeline failed before completing a grounded comparison.
- A reliable verdict requires successful extraction, retrieval, and evidence-based generation.

### RECOMMENDATIONS
- Retry the same document once.
- If failure persists, upload a text-based export alongside the PDF.`;
          await writeReportToStream(writer, fallback, []);
          writer.write({ type: "finish-step" } as any);
          writer.write({ type: "finish", finishReason: "stop" } as any);
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  // --- Convert messages and inject extracted content ---
  let modelMessages = await convertToModelMessages(messages);

  // --- Stream with enhanced tools ---
  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(8),
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 10240,
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
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
          return {
            error:
              "No PDF document was uploaded with this message. Upload a PDF to use analyzeSubmittal.",
          };
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

          // Filter out obvious junk / form fields / empty clauses.
          const filtered = results.filter((r) => {
            if (!r.clauseNumber || r.clauseNumber.trim() === "") return false;
            if (!r.content || r.content.trim().length < MIN_CONTENT_CHARS) return false;
            if (/\.{3,}\s*\d+\s*$/.test(r.clauseTitle)) return false;
            if (/^(?:scope|introduction|references)$/i.test(r.clauseTitle.trim()) && r.isGraph) {
              return false;
            }
            if (
              /(company name|inspection date|plant location|plant no\/s|plant manufacturer|plant id no|approval certificate no|contact a plant|yes\s*☐\s*no\s*☐)/i.test(
                r.clauseTitle
              )
            ) {
              return false;
            }
            return true;
          });

          // Deduplicate by section+part+clause, preferring vector and higher score.
          const byClause = new Map<string, (typeof filtered)[number]>();
          for (const row of filtered) {
            const key = `${row.sectionNumber}|${row.partNumber}|${row.clauseNumber}`;
            const existing = byClause.get(key);
            if (!existing) {
              byClause.set(key, row);
              continue;
            }
            const preferNew =
              (existing.isGraph && !row.isGraph) ||
              (existing.isGraph === row.isGraph && row.score > existing.score);
            if (preferNew) byClause.set(key, row);
          }
          const deduped = Array.from(byClause.values());

          // Rank: vector first, then score desc.
          deduped.sort((a, b) => {
            if (a.isGraph !== b.isGraph) return a.isGraph ? 1 : -1;
            return b.score - a.score;
          });

          // Cap graph-heavy expansion and overall refs per query.
          const selected: typeof deduped = [];
          let graphCount = 0;
          for (const row of deduped) {
            if (row.isGraph) {
              if (graphCount >= MAX_GRAPH_REFS_PER_QUERY) continue;
              graphCount += 1;
            }
            selected.push(row);
            if (selected.length >= MAX_REFS_PER_QUERY) break;
          }

          // Clean up TOC artifacts from clause titles for display
          const cleaned = selected.map((r) => {
            const cleanTitle = r.clauseTitle.replace(/\s*\.{3,}\s*\d+\s*$/, "").trim();
            return {
              reference: `QCS 2024 Section ${r.sectionNumber}: ${r.sectionTitle}, Part ${r.partNumber}: ${r.partTitle}, Clause ${r.clauseNumber}: ${cleanTitle} (Pages ${r.pageStart}-${r.pageEnd})`,
              content: r.content,
              relevanceScore: r.score,
              source: r.isGraph ? "graph" : "vector",
            };
          });

          return cleaned;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
