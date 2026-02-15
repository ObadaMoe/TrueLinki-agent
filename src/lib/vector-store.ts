import { Index } from "@upstash/vector";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";

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
}

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
    }));
}
