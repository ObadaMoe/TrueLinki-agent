import { Redis } from "@upstash/redis";

// ============================================================================
// Client
// ============================================================================

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

// ============================================================================
// Types
// ============================================================================

export interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface GraphRelationship {
  id: string;
  type: string;
  sourceEntity: string;
  targetEntity: string;
  chunkIds: string[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Given a list of chunk IDs (from vector search), return all entity IDs
 * found in those chunks.
 */
export async function getEntitiesForChunks(
  chunkIds: string[]
): Promise<string[]> {
  if (chunkIds.length === 0) return [];

  const pipeline = getRedis().pipeline();
  for (const cid of chunkIds) {
    pipeline.smembers(`g:chunk:${cid}:ents`);
  }
  const results = await pipeline.exec<string[][]>();

  const entityIds = new Set<string>();
  for (const members of results) {
    if (Array.isArray(members)) {
      for (const eid of members) {
        entityIds.add(eid);
      }
    }
  }
  return Array.from(entityIds);
}

/**
 * Given entity IDs, traverse 1-2 hops and return related chunk IDs.
 * Hop 1: entity -> relationships -> other entities + chunk IDs
 * Hop 2: those new entities -> their relationships -> more chunk IDs
 */
export async function traverseGraph(
  entityIds: string[],
  maxHops: number = 2,
  maxRelatedChunks: number = 20
): Promise<string[]> {
  if (entityIds.length === 0) return [];

  const visitedEntities = new Set<string>(entityIds);
  const collectedChunkIds = new Set<string>();
  let currentEntities = entityIds;

  for (let hop = 0; hop < maxHops; hop++) {
    // Get all relationship IDs for current entities
    const relPipeline = getRedis().pipeline();
    for (const eid of currentEntities) {
      relPipeline.smembers(`g:ent:${eid}:rels`);
    }
    const relResults = await relPipeline.exec<string[][]>();

    const relIds = new Set<string>();
    for (const members of relResults) {
      if (Array.isArray(members)) {
        for (const rid of members) {
          relIds.add(rid);
        }
      }
    }

    if (relIds.size === 0) break;

    // Fetch relationship details
    const detailPipeline = getRedis().pipeline();
    for (const rid of relIds) {
      detailPipeline.hgetall(`g:rel:${rid}`);
    }
    const detailResults = await detailPipeline.exec<
      (Record<string, string> | null)[]
    >();

    const nextEntities: string[] = [];
    for (const rel of detailResults) {
      if (!rel) continue;

      // Collect chunk IDs from this relationship
      if (rel.chunkIds) {
        for (const cid of rel.chunkIds.split(",")) {
          collectedChunkIds.add(cid.trim());
          if (collectedChunkIds.size >= maxRelatedChunks) break;
        }
      }

      if (collectedChunkIds.size >= maxRelatedChunks) break;

      // Discover new entities for next hop
      for (const key of ["sourceEntity", "targetEntity"] as const) {
        const eid = rel[key];
        if (eid && !visitedEntities.has(eid)) {
          visitedEntities.add(eid);
          nextEntities.push(eid);
        }
      }
    }

    if (collectedChunkIds.size >= maxRelatedChunks) break;
    currentEntities = nextEntities;
    if (currentEntities.length === 0) break;
  }

  return Array.from(collectedChunkIds).slice(0, maxRelatedChunks);
}
