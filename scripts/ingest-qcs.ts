import { extractText, getDocumentProxy } from "unpdf";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const PDF_PATH = join(process.cwd(), "data/QCS2024.pdf");
const OUTPUT_PATH = join(process.cwd(), "data/qcs-chunks.json");

interface QCSChunk {
  id: string;
  sectionNumber: string;
  sectionTitle: string;
  partNumber: string;
  partTitle: string;
  clauseNumber: string;
  clauseTitle: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenEstimate: number;
}

// Parse section/part info from page header lines
function parsePageHeader(pageText: string): {
  section: string;
  sectionTitle: string;
  part: string;
  partTitle: string;
} | null {
  // Match: "QCS 2024 Section 01: General Page 2" or "QCS 2022 Section 01: General Page 2"
  const sectionMatch = pageText.match(
    /QCS\s+20\d{2}\s+Section\s+(\d+):\s*(.+?)\s+Page\s+\d+/i
  );
  // Match: "Part 01: Introduction" or "Part 10: Welfare, Occupational Health and Safety"
  const partMatch = pageText.match(/Part\s+(\d+):\s*(.+?)(?:\n|$)/i);

  if (sectionMatch) {
    return {
      section: sectionMatch[1],
      sectionTitle: sectionMatch[2].trim(),
      part: partMatch ? partMatch[1] : "00",
      partTitle: partMatch ? partMatch[2].trim() : "",
    };
  }
  return null;
}

// Remove page headers/footers from text
function cleanPageText(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip "Ashghal." header
    if (trimmed === "Ashghal." || trimmed === "Ashghal") continue;
    // Skip page header lines like "QCS 2024 Section XX: Title Page N"
    if (/^QCS\s+20\d{2}\s+Section\s+\d+/i.test(trimmed)) continue;
    // Skip part header lines in page headers like "Part XX: Title"
    if (/^Part\s+\d+:\s*.+$/i.test(trimmed) && trimmed.length < 80) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

// Check if a line is a clause header like "1.1.1 Scope" or "6.2 TRIAL LENGTH"
function parseClauseHeader(
  line: string
): { number: string; title: string } | null {
  const match = line.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  if (match) {
    const num = match[1];
    const title = match[2].trim();
    // Ensure it's actually a clause header and not just a numbered list item
    // Clause headers typically have titles in Title Case or ALL CAPS
    // and the number has at least one dot (like 1.1, 1.1.1)
    if (num.includes(".") && title.length > 1) {
      return { number: num, title };
    }
  }
  return null;
}

const MAX_CHUNK_TOKENS = 800;
const OVERLAP_SENTENCES = 2;

function splitOversizedChunk(chunk: QCSChunk): QCSChunk[] {
  if (chunk.tokenEstimate <= MAX_CHUNK_TOKENS) {
    return [chunk];
  }

  // Try splitting by double newlines first, then by single newlines
  let segments = chunk.content.split(/\n\n+/);
  if (segments.length <= 1) {
    segments = chunk.content.split(/\n/);
  }

  const results: QCSChunk[] = [];
  let currentContent = "";
  let partIndex = 0;

  for (const seg of segments) {
    const separator = segments.length > 1 ? "\n" : " ";
    const combined = currentContent
      ? `${currentContent}${separator}${seg}`
      : seg;
    const combinedTokens = Math.ceil(combined.length / 4);

    if (combinedTokens > MAX_CHUNK_TOKENS && currentContent) {
      results.push({
        ...chunk,
        id: `${chunk.id}_p${partIndex}`,
        content: currentContent.trim(),
        tokenEstimate: Math.ceil(currentContent.length / 4),
      });
      partIndex++;
      currentContent = seg;
    } else {
      currentContent = combined;
    }
  }

  if (currentContent.trim()) {
    results.push({
      ...chunk,
      id: `${chunk.id}_p${partIndex}`,
      content: currentContent.trim(),
      tokenEstimate: Math.ceil(currentContent.trim().length / 4),
    });
  }

  // If we still have oversized chunks (single very long lines), force-split by character count
  const finalResults: QCSChunk[] = [];
  for (const r of results.length > 0 ? results : [chunk]) {
    if (r.tokenEstimate > MAX_CHUNK_TOKENS * 2) {
      const maxChars = MAX_CHUNK_TOKENS * 4;
      for (let i = 0; i < r.content.length; i += maxChars) {
        const slice = r.content.substring(i, i + maxChars);
        finalResults.push({
          ...r,
          id: `${r.id}_f${Math.floor(i / maxChars)}`,
          content: slice.trim(),
          tokenEstimate: Math.ceil(slice.length / 4),
        });
      }
    } else {
      finalResults.push(r);
    }
  }

  return finalResults.length > 0 ? finalResults : [chunk];
}

async function main() {
  const startTime = Date.now();

  console.log("Step 1: Loading PDF...");
  const buffer = await readFile(PDF_PATH);
  console.log(`  PDF size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    verbosity: 0,
  });
  console.log(`  Total pages: ${pdf.numPages}`);

  console.log("Step 2: Extracting text from all pages...");
  const { text: pageTexts } = await extractText(pdf, { mergePages: false });
  await pdf.destroy();
  console.log(`  Extracted text from ${pageTexts.length} pages`);

  console.log("Step 3: Parsing document structure...");

  const rawChunks: QCSChunk[] = [];
  let currentSection = "00";
  let currentSectionTitle = "Preface";
  let currentPart = "00";
  let currentPartTitle = "";
  let currentClauseNumber = "";
  let currentClauseTitle = "";
  let currentContent: string[] = [];
  let chunkPageStart = 1;

  function flushChunk(pageEnd: number) {
    const content = currentContent.join("\n").trim();
    if (!content || content.length < 10) return;

    const id = `S${currentSection}_P${currentPart}_C${currentClauseNumber || "intro"}`;
    rawChunks.push({
      id,
      sectionNumber: currentSection,
      sectionTitle: currentSectionTitle,
      partNumber: currentPart,
      partTitle: currentPartTitle,
      clauseNumber: currentClauseNumber,
      clauseTitle: currentClauseTitle,
      content,
      pageStart: chunkPageStart,
      pageEnd,
      tokenEstimate: Math.ceil(content.length / 4),
    });
    currentContent = [];
  }

  for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
    const pageNum = pageIdx + 1;

    if (pageNum % 500 === 0) {
      console.log(`  Processing page ${pageNum}/${pageTexts.length}...`);
    }

    const rawText = pageTexts[pageIdx];
    if (!rawText || rawText.trim().length < 20) continue;

    // Parse header info
    const header = parsePageHeader(rawText);
    if (header) {
      // Check if we've moved to a new section or part
      if (header.section !== currentSection || header.part !== currentPart) {
        flushChunk(pageNum - 1);
        currentSection = header.section;
        currentSectionTitle = header.sectionTitle;
        currentPart = header.part;
        currentPartTitle = header.partTitle;
        currentClauseNumber = "";
        currentClauseTitle = "";
        chunkPageStart = pageNum;
      }
    }

    // Clean the page text (remove headers/footers)
    const cleanedText = cleanPageText(rawText);
    if (!cleanedText) continue;

    // Process lines looking for clause headers
    const lines = cleanedText.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const clause = parseClauseHeader(trimmed);
      if (clause) {
        // New clause found - flush previous chunk
        flushChunk(pageNum);
        currentClauseNumber = clause.number;
        currentClauseTitle = clause.title;
        chunkPageStart = pageNum;
        currentContent.push(trimmed);
      } else {
        currentContent.push(trimmed);
      }
    }
  }

  // Flush the last chunk
  flushChunk(pageTexts.length);

  console.log(`  Found ${rawChunks.length} raw chunks`);

  // Deduplicate chunks (same id gets merged or latest wins)
  const chunkMap = new Map<string, QCSChunk>();
  let dupeCount = 0;
  for (const chunk of rawChunks) {
    const existing = chunkMap.get(chunk.id);
    if (existing) {
      // Append content and expand page range
      dupeCount++;
      const uniqueId = `${chunk.id}_${dupeCount}`;
      chunkMap.set(uniqueId, { ...chunk, id: uniqueId });
    } else {
      chunkMap.set(chunk.id, chunk);
    }
  }

  const dedupedChunks = Array.from(chunkMap.values());
  console.log(`  After dedup: ${dedupedChunks.length} chunks`);

  console.log("Step 4: Splitting oversized chunks...");
  const finalChunks: QCSChunk[] = [];
  for (const chunk of dedupedChunks) {
    finalChunks.push(...splitOversizedChunk(chunk));
  }
  // Filter out tiny chunks (< 10 tokens / ~40 chars)
  const meaningfulChunks = finalChunks.filter((c) => c.tokenEstimate >= 10);
  console.log(
    `  Final chunk count: ${meaningfulChunks.length} (filtered ${finalChunks.length - meaningfulChunks.length} tiny chunks)`
  );

  // Stats
  const filteredChunks = meaningfulChunks;
  const totalTokens = filteredChunks.reduce((s, c) => s + c.tokenEstimate, 0);
  const avgTokens = Math.round(totalTokens / filteredChunks.length);
  const maxTokens = Math.max(...filteredChunks.map((c) => c.tokenEstimate));
  const minTokens = Math.min(...filteredChunks.map((c) => c.tokenEstimate));

  console.log(`\nStats:`);
  console.log(`  Total estimated tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Avg tokens/chunk: ${avgTokens}`);
  console.log(`  Min tokens/chunk: ${minTokens}`);
  console.log(`  Max tokens/chunk: ${maxTokens}`);

  // Sections breakdown
  const sections = new Map<string, number>();
  for (const chunk of filteredChunks) {
    const key = `Section ${chunk.sectionNumber}: ${chunk.sectionTitle}`;
    sections.set(key, (sections.get(key) || 0) + 1);
  }
  console.log(`\nSections breakdown:`);
  for (const [section, count] of Array.from(sections.entries()).sort()) {
    console.log(`  ${section}: ${count} chunks`);
  }

  console.log("\nStep 5: Writing output...");
  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(filteredChunks, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
