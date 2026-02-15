import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Index } from "@upstash/vector";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

const CHUNKS_PATH = join(process.cwd(), "data/qcs-chunks.json");
const BATCH_SIZE = 100; // Embeddings per batch
const UPSERT_BATCH_SIZE = 100; // Vectors per upsert call

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

const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});

const embeddingModel = openai.embedding("text-embedding-3-small");

async function main() {
  const startTime = Date.now();

  // Validate env vars
  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY not set. Add it to .env.local");
    process.exit(1);
  }
  if (!process.env.UPSTASH_VECTOR_REST_URL) {
    console.error(
      "ERROR: UPSTASH_VECTOR_REST_URL not set. Add it to .env.local"
    );
    process.exit(1);
  }

  console.log("Step 1: Loading chunks...");
  const raw = await readFile(CHUNKS_PATH, "utf-8");
  const chunks: QCSChunk[] = JSON.parse(raw);
  console.log(`  Loaded ${chunks.length} chunks`);

  const totalTokens = chunks.reduce((s, c) => s + c.tokenEstimate, 0);
  console.log(
    `  Estimated total tokens: ${totalTokens.toLocaleString()} (~$${((totalTokens / 1_000_000) * 0.02).toFixed(2)} for embeddings)`
  );

  console.log("\nStep 2: Generating embeddings and uploading to Upstash...");
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    try {
      // Generate embeddings for the batch
      const texts = batch.map((c) => {
        // Prefix with metadata for better retrieval
        const prefix = `Section ${c.sectionNumber}: ${c.sectionTitle} | Part ${c.partNumber}: ${c.partTitle} | Clause ${c.clauseNumber}: ${c.clauseTitle}`;
        return `${prefix}\n\n${c.content}`;
      });

      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: texts,
      });

      // Upsert to Upstash Vector in sub-batches
      for (let j = 0; j < batch.length; j += UPSERT_BATCH_SIZE) {
        const upsertBatch = batch.slice(j, j + UPSERT_BATCH_SIZE);
        const vectors = upsertBatch.map((chunk, idx) => ({
          id: chunk.id,
          vector: embeddings[j + idx],
          metadata: {
            sectionNumber: chunk.sectionNumber,
            sectionTitle: chunk.sectionTitle,
            partNumber: chunk.partNumber,
            partTitle: chunk.partTitle,
            clauseNumber: chunk.clauseNumber,
            clauseTitle: chunk.clauseTitle,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            content: chunk.content.substring(0, 3500), // Upstash metadata limit ~48KB, keep content reasonable
          },
        }));

        await index.upsert(vectors);
      }

      processed += batch.length;
      if (processed % 500 === 0 || processed === chunks.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = ((processed / chunks.length) * 100).toFixed(1);
        console.log(
          `  [${elapsed}s] Processed ${processed}/${chunks.length} (${pct}%)`
        );
      }
    } catch (err: any) {
      errors++;
      console.error(
        `  ERROR at batch ${i}-${i + batch.length}: ${err.message}`
      );
      // Wait and retry once
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const texts = batch.map(
          (c) =>
            `Section ${c.sectionNumber}: ${c.sectionTitle} | Clause ${c.clauseNumber}\n\n${c.content}`
        );
        const { embeddings } = await embedMany({
          model: embeddingModel,
          values: texts,
        });
        const vectors = batch.map((chunk, idx) => ({
          id: chunk.id,
          vector: embeddings[idx],
          metadata: {
            sectionNumber: chunk.sectionNumber,
            sectionTitle: chunk.sectionTitle,
            partNumber: chunk.partNumber,
            partTitle: chunk.partTitle,
            clauseNumber: chunk.clauseNumber,
            clauseTitle: chunk.clauseTitle,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            content: chunk.content.substring(0, 3500),
          },
        }));
        await index.upsert(vectors);
        processed += batch.length;
        console.log(`  Retry succeeded for batch ${i}`);
      } catch (retryErr: any) {
        console.error(`  Retry failed: ${retryErr.message}`);
      }
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Processed: ${processed}/${chunks.length}`);
  console.log(`  Errors: ${errors}`);

  // Verify by checking index info
  const info = await index.info();
  console.log(`\nUpstash Vector Index Info:`);
  console.log(`  Vectors: ${info.vectorCount}`);
  console.log(`  Dimensions: ${info.dimension}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
