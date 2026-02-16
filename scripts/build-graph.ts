import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const CHUNKS_PATH = join(process.cwd(), "data/qcs-chunks.json");
const PROGRESS_PATH = join(process.cwd(), "data/graph-progress.json");

const MAX_GROUP_TOKENS = 2000;
const OVERLAP_SENTENCES = 2;
const GROUPS_PER_CALL = 3; // Keep batches small for fast responses
const RATE_LIMIT_DELAY_MS = 100; // GPT-4o-mini handles high throughput
const RETRY_DELAY_MS = 2000;
const CONCURRENCY = 5; // Run 5 API calls in parallel

// Resume from this group index (set via env var START_FROM=500)
const START_FROM = parseInt(process.env.START_FROM || "0", 10);

// ============================================================================
// Types
// ============================================================================

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

interface ChunkGroup {
  chunkIds: string[];
  combinedContent: string;
  sectionNumber: string;
  sectionTitle: string;
  partNumber: string;
  partTitle: string;
  tokenEstimate: number;
}

// ============================================================================
// Clients
// ============================================================================

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// GPT-4o-mini: fast, cheap ($0.15/1M input, $0.60/1M output), great at structured extraction
const extractionModel = openai("gpt-4o-mini");

// ============================================================================
// Extraction Schema
// ============================================================================

const ExtractionSchema = z.object({
  groups: z.array(
    z.object({
      groupIndex: z.number(),
      entities: z.array(
        z.object({
          name: z.string().describe("Canonical full name of the entity"),
          type: z.enum([
            "MATERIAL",
            "STANDARD",
            "TEST_METHOD",
            "PROPERTY",
            "COMPONENT",
            "ORGANIZATION",
            "CLAUSE",
          ]),
          description: z.string().nullable(),
        })
      ),
      relationships: z.array(
        z.object({
          source: z
            .string()
            .describe("Source entity name (must match an entity name above)"),
          target: z
            .string()
            .describe("Target entity name (must match an entity name above)"),
          type: z.enum([
            "MUST_COMPLY_WITH",
            "TESTED_BY",
            "HAS_PROPERTY",
            "REFERENCES",
            "SUPERSEDES",
            "USED_IN",
            "REQUIRES",
            "APPROVED_BY",
            "MINIMUM_VALUE",
            "ALTERNATIVE_TO",
          ]),
        })
      ),
    })
  ),
});

const EXTRACTION_SYSTEM_PROMPT = `You are a construction specifications knowledge graph extractor.
Given text chunks from Qatar Construction Specifications (QCS 2024), extract:

1. ENTITIES - Named things mentioned in the text:
   - MATERIAL: Physical materials (e.g., "Portland Cement Type I", "Gabbro aggregate")
   - STANDARD: Referenced standards (e.g., "ASTM C150", "BS EN 197-1", "QCS 2024 Section 5")
   - TEST_METHOD: Testing procedures (e.g., "Compressive strength test at 28 days", "Slump test")
   - PROPERTY: Measurable properties with thresholds (e.g., "Compressive strength 28-day minimum 40 MPa", "Water/cement ratio maximum 0.45")
   - COMPONENT: Construction components (e.g., "Foundation", "Structural column", "Retaining wall")
   - ORGANIZATION: Bodies/companies (e.g., "Ashghal", "ASTM International", "Qatar Standards")
   - CLAUSE: Specific QCS clause references (e.g., "Clause 5.3.2", "Section 5 Part 3")

2. RELATIONSHIPS between those entities:
   - MUST_COMPLY_WITH: Material/component must meet a standard
   - TESTED_BY: Material/property verified by a test method
   - HAS_PROPERTY: Material/component has a measurable property
   - REFERENCES: One standard/clause references another
   - SUPERSEDES: One standard replaces another
   - USED_IN: Material is used in a component
   - REQUIRES: Component/process requires a material/property
   - APPROVED_BY: Material/method approved by an organization
   - MINIMUM_VALUE: Property has a minimum threshold
   - ALTERNATIVE_TO: One material/method can substitute another

Rules:
- Use canonical, full names for entities (not abbreviations). E.g., "Ordinary Portland Cement" not "OPC"
- Only extract entities and relationships explicitly stated in the text
- Each group is independent; extract per group using the groupIndex provided
- Keep entity names consistent across groups when referring to the same thing
- Preserve numeric thresholds exactly (don't round)
- If no entities or relationships are found in a group, return empty arrays for that group`;

// ============================================================================
// Helpers
// ============================================================================

function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function entityId(type: string, name: string): string {
  return `${type}:${normalizeEntityName(name)}`;
}

function getLastSentences(text: string, n: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  return sentences
    .slice(-n)
    .join(" ")
    .trim();
}

// ============================================================================
// Chunk Grouping
// ============================================================================

function groupChunks(chunks: QCSChunk[]): ChunkGroup[] {
  // Sort chunks by section, part, then clause number for adjacency
  const sorted = [...chunks].sort((a, b) => {
    const keyA = `${a.sectionNumber}_${a.partNumber}_${a.clauseNumber}`;
    const keyB = `${b.sectionNumber}_${b.partNumber}_${b.clauseNumber}`;
    return keyA.localeCompare(keyB, undefined, { numeric: true });
  });

  const groups: ChunkGroup[] = [];
  let currentGroup: QCSChunk[] = [];
  let currentTokens = 0;
  let previousGroupLastContent = "";

  for (const chunk of sorted) {
    const sameContext =
      currentGroup.length === 0 ||
      (chunk.sectionNumber === currentGroup[0].sectionNumber &&
        chunk.partNumber === currentGroup[0].partNumber);

    if (
      sameContext &&
      currentTokens + chunk.tokenEstimate <= MAX_GROUP_TOKENS
    ) {
      currentGroup.push(chunk);
      currentTokens += chunk.tokenEstimate;
    } else {
      if (currentGroup.length > 0) {
        const group = buildGroup(currentGroup, previousGroupLastContent);
        groups.push(group);
        // Save last content for overlap
        previousGroupLastContent =
          currentGroup[currentGroup.length - 1].content;
      }

      // If context changed (different section/part), reset overlap
      if (!sameContext) {
        previousGroupLastContent = "";
      }

      currentGroup = [chunk];
      currentTokens = chunk.tokenEstimate;
    }
  }

  // Flush last group
  if (currentGroup.length > 0) {
    groups.push(buildGroup(currentGroup, previousGroupLastContent));
  }

  return groups;
}

function buildGroup(
  chunks: QCSChunk[],
  previousContent?: string
): ChunkGroup {
  const parts: string[] = [];

  // Add overlap from previous group
  if (previousContent && OVERLAP_SENTENCES > 0) {
    const overlap = getLastSentences(previousContent, OVERLAP_SENTENCES);
    if (overlap.length > 20) {
      parts.push(`[context overlap] ${overlap}`);
    }
  }

  for (const c of chunks) {
    const header = c.clauseNumber
      ? `[Clause ${c.clauseNumber}: ${c.clauseTitle}]`
      : `[Section ${c.sectionNumber}, Part ${c.partNumber}]`;
    parts.push(`${header}\n${c.content}`);
  }

  const combined = parts.join("\n\n");

  return {
    chunkIds: chunks.map((c) => c.id),
    combinedContent: combined,
    sectionNumber: chunks[0].sectionNumber,
    sectionTitle: chunks[0].sectionTitle,
    partNumber: chunks[0].partNumber,
    partTitle: chunks[0].partTitle,
    tokenEstimate: Math.ceil(combined.length / 4),
  };
}

// ============================================================================
// LLM Extraction
// ============================================================================

async function extractBatch(
  groups: ChunkGroup[],
  batchIndex: number
): Promise<z.infer<typeof ExtractionSchema> | null> {
  const userContent = groups
    .map(
      (g, i) =>
        `--- GROUP ${i} (Section ${g.sectionNumber}: ${g.sectionTitle}, Part ${g.partNumber}: ${g.partTitle}) ---\n` +
        `Chunks: ${g.chunkIds.join(", ")}\n\n` +
        g.combinedContent
    )
    .join("\n\n");

  try {
    // Try generateObject first (structured output)
    const { object } = await generateObject({
      model: extractionModel,
      schema: ExtractionSchema,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: userContent,
      temperature: 0,
    });
    return object;
  } catch (structuredErr: any) {
    // Fallback: use generateText + manual parse
    console.warn(
      `  [Batch ${batchIndex}] generateObject failed (${structuredErr.message}), falling back to generateText...`
    );

    try {
      const { text } = await generateText({
        model: extractionModel,
        system:
          EXTRACTION_SYSTEM_PROMPT +
          "\n\nYou MUST respond with valid JSON matching this structure: " +
          JSON.stringify({
            groups: [
              {
                groupIndex: 0,
                entities: [{ name: "string", type: "MATERIAL", description: "string or null" }],
                relationships: [{ source: "string", target: "string", type: "MUST_COMPLY_WITH" }],
              },
            ],
          }),
        prompt: userContent,
        temperature: 0,
      });

      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`  [Batch ${batchIndex}] No JSON found in response`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return ExtractionSchema.parse(parsed);
    } catch (fallbackErr: any) {
      console.error(
        `  [Batch ${batchIndex}] Fallback also failed: ${fallbackErr.message}`
      );
      return null;
    }
  }
}

// ============================================================================
// Redis Write
// ============================================================================

async function writeGraphBatch(
  extraction: z.infer<typeof ExtractionSchema>,
  groups: ChunkGroup[]
): Promise<{ entities: number; relationships: number }> {
  let entCount = 0;
  let relCount = 0;

  for (const groupResult of extraction.groups) {
    const group = groups[groupResult.groupIndex];
    if (!group) continue;

    const pipeline = redis.pipeline();

    // Write entities
    for (const ent of groupResult.entities) {
      const eid = entityId(ent.type, ent.name);

      pipeline.hset(`g:ent:${eid}`, {
        name: ent.name,
        type: ent.type,
        ...(ent.description ? { description: ent.description } : {}),
      });

      // Index: normalized name -> entity ID
      pipeline.set(`g:ent:idx:${normalizeEntityName(ent.name)}`, eid);

      // Link entity to all chunk IDs in this group
      for (const chunkId of group.chunkIds) {
        pipeline.sadd(`g:chunk:${chunkId}:ents`, eid);
      }

      entCount++;
    }

    // Write relationships
    for (const rel of groupResult.relationships) {
      const srcEntity = groupResult.entities.find(
        (e) => e.name === rel.source
      );
      const tgtEntity = groupResult.entities.find(
        (e) => e.name === rel.target
      );

      const srcId = entityId(srcEntity?.type || "MATERIAL", rel.source);
      const tgtId = entityId(tgtEntity?.type || "MATERIAL", rel.target);
      const relId = `${srcId}--${rel.type}--${tgtId}`;

      pipeline.hset(`g:rel:${relId}`, {
        type: rel.type,
        sourceEntity: srcId,
        targetEntity: tgtId,
        chunkIds: group.chunkIds.join(","),
      });

      // Bidirectional: both entities know about this relationship
      pipeline.sadd(`g:ent:${srcId}:rels`, relId);
      pipeline.sadd(`g:ent:${tgtId}:rels`, relId);

      relCount++;
    }

    // Only exec if pipeline has commands
    if (groupResult.entities.length > 0 || groupResult.relationships.length > 0) {
      await pipeline.exec();
    }
  }

  return { entities: entCount, relationships: relCount };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startTime = Date.now();

  // Validate env vars
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "ERROR: OPENAI_API_KEY not set. Add it to .env.local"
    );
    process.exit(1);
  }
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.error(
      "ERROR: UPSTASH_REDIS_REST_URL not set. Add it to .env.local"
    );
    process.exit(1);
  }
  if (!process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error(
      "ERROR: UPSTASH_REDIS_REST_TOKEN not set. Add it to .env.local"
    );
    process.exit(1);
  }

  // Step 1: Load chunks
  console.log("Step 1: Loading chunks...");
  const raw = await readFile(CHUNKS_PATH, "utf-8");
  const chunks: QCSChunk[] = JSON.parse(raw);
  console.log(`  Loaded ${chunks.length} chunks`);

  // Step 2: Group chunks into ~2000-token windows
  console.log("\nStep 2: Grouping chunks into ~2000-token windows...");
  const groups = groupChunks(chunks);
  console.log(`  Created ${groups.length} groups`);

  const avgTokens = Math.round(
    groups.reduce((s, g) => s + g.tokenEstimate, 0) / groups.length
  );
  const avgChunks = (
    groups.reduce((s, g) => s + g.chunkIds.length, 0) / groups.length
  ).toFixed(1);
  console.log(`  Avg tokens/group: ${avgTokens}`);
  console.log(`  Avg chunks/group: ${avgChunks}`);

  const totalCalls = Math.ceil(groups.length / GROUPS_PER_CALL);
  const estimatedMinutes = Math.ceil(
    (totalCalls * RATE_LIMIT_DELAY_MS) / 60000
  );
  console.log(
    `  LLM calls needed: ${totalCalls} (~${estimatedMinutes} min at ${Math.round(60000 / RATE_LIMIT_DELAY_MS)} req/min)`
  );

  if (START_FROM > 0) {
    console.log(`  Resuming from group index ${START_FROM}`);
  }

  // Step 3: Extract entities and relationships
  console.log("\nStep 3: Extracting entities & relationships...");
  console.log(`  Concurrency: ${CONCURRENCY} parallel calls`);
  let totalEntities = 0;
  let totalRelationships = 0;
  let errors = 0;
  let processed = START_FROM;

  // Build all batches upfront
  const batches: { batch: ChunkGroup[]; batchIndex: number; startIdx: number }[] = [];
  for (let i = START_FROM; i < groups.length; i += GROUPS_PER_CALL) {
    batches.push({
      batch: groups.slice(i, i + GROUPS_PER_CALL),
      batchIndex: Math.floor(i / GROUPS_PER_CALL),
      startIdx: i,
    });
  }

  // Process in parallel waves
  for (let w = 0; w < batches.length; w += CONCURRENCY) {
    const wave = batches.slice(w, w + CONCURRENCY);
    const waveNum = Math.floor(w / CONCURRENCY) + 1;
    const totalWaves = Math.ceil(batches.length / CONCURRENCY);

    console.log(
      `  Wave ${waveNum}/${totalWaves} — ${wave.length} calls in parallel...`
    );

    const results = await Promise.allSettled(
      wave.map(async ({ batch, batchIndex, startIdx }) => {
        // Try extraction
        let extraction = await extractBatch(batch, batchIndex);

        // Retry once on failure
        if (!extraction) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          extraction = await extractBatch(batch, batchIndex);
        }

        if (!extraction) {
          return { ok: false as const, groups: batch.length };
        }

        // Write to Redis
        const counts = await writeGraphBatch(extraction, batch);
        return { ok: true as const, groups: batch.length, ...counts };
      })
    );

    // Tally results
    let waveEnts = 0;
    let waveRels = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        waveEnts += r.value.entities;
        waveRels += r.value.relationships;
        processed += r.value.groups;
      } else if (r.status === "fulfilled" && !r.value.ok) {
        errors++;
        processed += r.value.groups;
      } else {
        // Promise rejected
        errors++;
        console.error(`    ✗ Promise rejected: ${(r as any).reason?.message || "unknown"}`);
      }
    }
    totalEntities += waveEnts;
    totalRelationships += waveRels;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((processed / groups.length) * 100).toFixed(1);
    console.log(
      `    ✓ +${waveEnts}E +${waveRels}R | Total: ${totalEntities}E ${totalRelationships}R | ${pct}% (${elapsed}s) | Errors: ${errors}`
    );

    // Save checkpoint every few waves
    if (waveNum % 5 === 0 || w + CONCURRENCY >= batches.length) {
      await writeFile(
        PROGRESS_PATH,
        JSON.stringify(
          {
            lastProcessedGroup: processed,
            totalGroups: groups.length,
            totalEntities,
            totalRelationships,
            errors,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );
    }

    // Small delay between waves to be polite
    if (w + CONCURRENCY < batches.length) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  // Step 4: Write metadata
  console.log("\nStep 4: Writing graph metadata...");
  await redis.hset("g:meta", {
    totalEntities: totalEntities.toString(),
    totalRelationships: totalRelationships.toString(),
    builtAt: new Date().toISOString(),
    sourceChunks: chunks.length.toString(),
    groups: groups.length.toString(),
  });

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Groups processed: ${processed}/${groups.length}`);
  console.log(`  Total entities: ${totalEntities}`);
  console.log(`  Total relationships: ${totalRelationships}`);
  console.log(`  Errors: ${errors}`);

  // Save final checkpoint
  await writeFile(
    PROGRESS_PATH,
    JSON.stringify(
      {
        lastProcessedGroup: processed,
        totalGroups: groups.length,
        totalEntities,
        totalRelationships,
        errors,
        completed: true,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
