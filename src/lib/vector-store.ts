import { Index } from "@upstash/vector";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { getEntitiesForChunks, traverseGraph } from "./graph-store";

const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});

const embeddingModel = openai.embedding("text-embedding-3-small");

export interface QCSSearchResult {
  id: string;
  score: number;
  sectionNumber: string;
  sectionTitle: string;
  partNumber: string;
  partTitle: string;
  clauseNumber: string;
  clauseTitle: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  /** True if this result was discovered via graph traversal, not vector similarity */
  isGraph: boolean;
}

/**
 * Standard vector similarity search against Upstash Vector.
 */
export async function searchQCS(
  query: string,
  topK: number = 8
): Promise<QCSSearchResult[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
  });

  const results = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
  });

  return results
    .filter((r) => r.metadata)
    .map((r) => ({
      id: r.id as string,
      score: r.score,
      sectionNumber: (r.metadata as any).sectionNumber || "",
      sectionTitle: (r.metadata as any).sectionTitle || "",
      partNumber: (r.metadata as any).partNumber || "",
      partTitle: (r.metadata as any).partTitle || "",
      clauseNumber: (r.metadata as any).clauseNumber || "",
      clauseTitle: (r.metadata as any).clauseTitle || "",
      pageStart: (r.metadata as any).pageStart || 0,
      pageEnd: (r.metadata as any).pageEnd || 0,
      content: (r.metadata as any).content || "",
      isGraph: false,
    }));
}

/**
 * Hybrid search: vector similarity + graph traversal.
 * 1. Vector search for top-K chunks
 * 2. Look up entities for those chunks in Redis graph
 * 3. Traverse graph 1-2 hops to find related chunks
 * 4. Fetch content for graph-discovered chunks from Upstash Vector by ID
 * 5. Return merged, deduplicated results (vector first, then graph)
 */
export async function hybridSearch(
  query: string,
  topK: number = 8,
  graphHops: number = 2,
  maxGraphChunks: number = 12
): Promise<QCSSearchResult[]> {
  // Step 1: Standard vector search
  const vectorResults = await searchQCS(query, topK);

  // Step 2: Get entities from vector result chunks
  const vectorChunkIds = vectorResults.map((r) => r.id);
  let entityIds: string[];

  try {
    entityIds = await getEntitiesForChunks(vectorChunkIds);
  } catch {
    // If Redis is unavailable, fall back to vector-only results
    console.warn("Graph store unavailable, returning vector-only results");
    return vectorResults;
  }

  if (entityIds.length === 0) {
    // No graph data for these chunks; return vector results only
    return vectorResults;
  }

  // Step 3: Traverse graph
  const graphChunkIds = await traverseGraph(
    entityIds,
    graphHops,
    maxGraphChunks
  );

  // Step 4: Filter out chunks we already have from vector search
  const existingIds = new Set(vectorChunkIds);
  const newChunkIds = graphChunkIds.filter((id) => !existingIds.has(id));

  if (newChunkIds.length === 0) {
    return vectorResults;
  }

  // Step 5: Fetch content for new chunks from Upstash Vector by ID
  const fetched = await index.fetch(newChunkIds, {
    includeMetadata: true,
  });

  const graphResults: QCSSearchResult[] = [];
  for (const item of fetched) {
    if (!item || !item.metadata) continue;
    const meta = item.metadata as Record<string, unknown>;
    graphResults.push({
      id: item.id as string,
      score: 0.5, // Synthetic score for graph-discovered results
      sectionNumber: (meta.sectionNumber as string) || "",
      sectionTitle: (meta.sectionTitle as string) || "",
      partNumber: (meta.partNumber as string) || "",
      partTitle: (meta.partTitle as string) || "",
      clauseNumber: (meta.clauseNumber as string) || "",
      clauseTitle: (meta.clauseTitle as string) || "",
      pageStart: (meta.pageStart as number) || 0,
      pageEnd: (meta.pageEnd as number) || 0,
      content: (meta.content as string) || "",
      isGraph: true,
    });
  }

  // Step 6: Merge — vector results first (higher confidence), then graph
  return [...vectorResults, ...graphResults];
}
