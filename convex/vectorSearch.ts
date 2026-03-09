import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// Helper to get documents by IDs
export const getDocumentsByIds = internalQuery({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const docMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (docs[i]) docMap[args.ids[i]] = docs[i];
    }
    return docMap;
  },
});

// Helper to get chunks by IDs
export const getChunksByIds = internalQuery({
  args: { ids: v.array(v.id("document_chunks")) },
  handler: async (ctx, args) => {
    const chunks = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const chunkMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (chunks[i]) chunkMap[args.ids[i]] = chunks[i];
    }
    return chunkMap;
  },
});

// Helper to get memories by IDs
export const getMemoriesByIds = internalQuery({
  args: { ids: v.array(v.id("memories")) },
  handler: async (ctx, args) => {
    const memories = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    const memoryMap: Record<string, any> = {};
    for (let i = 0; i < args.ids.length; i++) {
      if (memories[i]) memoryMap[args.ids[i]] = memories[i];
    }
    return memoryMap;
  },
});

// Get memories by containerTag (for two-stage search)
export const getMemoriesByContainerTag = internalQuery({
  args: {
    userId: v.string(),
    containerTag: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .take(limit);

    const filtered = memories.filter((m: any) => {
      if (m.is_forgotten === true) return false;
      if (m.is_latest === false) return false;
      const tags = m.container_tags || [];
      return tags.includes(args.containerTag);
    });
    
    console.log("[DEBUG] getMemoriesByContainerTag:", args.containerTag, "found", filtered.length, "of", memories.length);
    return filtered;
  },
});

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Calculate keyword boost
function calculateKeywordBoost(query: string, content: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return 1.0;
  const contentLower = content.toLowerCase();
  let matchCount = 0;
  for (const word of queryWords) {
    if (contentLower.includes(word)) matchCount++;
  }
  return 1.0 + (matchCount / queryWords.length) * 0.15;
}

// Search documents by vector similarity
export const searchDocuments = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;
    const results = await ctx.vectorSearch("documents", "by_embedding", {
      vector: args.embedding,
      limit: Math.min(limit * 2, 256),
      filter: (q) => q.eq("user_id", args.userId),
    });
    const filteredIds = results.filter((r: any) => r._score >= minScore).map((r: any) => r._id);
    if (filteredIds.length === 0) return [];
    const docMap = await ctx.runQuery(internal.vectorSearch.getDocumentsByIds, { ids: filteredIds });
    return results
      .filter((r: any) => r._score >= minScore && docMap[r._id])
      .map((r: any) => ({ ...docMap[r._id], score: r._score }))
      .slice(0, limit);
  },
});

// Search chunks by vector similarity
export const searchChunks = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.5;
    const results = await ctx.vectorSearch("document_chunks", "by_embedding", {
      vector: args.embedding,
      limit: Math.min(limit * 2, 256),
      filter: (q) => q.eq("user_id", args.userId),
    });
    const filteredIds = results.filter((r: any) => r._score >= minScore).map((r: any) => r._id);
    if (filteredIds.length === 0) return [];
    const chunkMap = await ctx.runQuery(internal.vectorSearch.getChunksByIds, { ids: filteredIds });
    return results
      .filter((r: any) => r._score >= minScore && chunkMap[r._id])
      .map((r: any) => ({ ...chunkMap[r._id], score: r._score }))
      .slice(0, limit);
  },
});

// Search memories by vector similarity
export const searchMemories = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    isCore: v.optional(v.boolean()),
    query: v.optional(v.string()),
    containerTag: v.optional(v.string()),
    metadataFilters: v.optional(v.object({
      category: v.optional(v.string()),
      type: v.optional(v.string()),
      isStatic: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.3;
    
    console.log("[DEBUG] searchMemories - userId:", args.userId, "containerTag:", args.containerTag);

    // TWO-STAGE SEARCH when containerTag is provided
    if (args.containerTag) {
      const memories = await ctx.runQuery(
        internal.vectorSearch.getMemoriesByContainerTag,
        { userId: args.userId, containerTag: args.containerTag, limit: 500 }
      );
      
      console.log("[DEBUG] Got", memories.length, "memories from getMemoriesByContainerTag");

      if (memories.length === 0) return [];

      // Calculate similarity for each memory
      const results = memories
        .filter((m: any) => m.embedding && m.embedding.length > 0)
        .map((m: any) => {
          let score = cosineSimilarity(args.embedding, m.embedding);
          
          // Minimal boosts
          const updatedAt = m.updated_at || m.created_at || 0;
          if (updatedAt > 0) {
            const ageInDays = Math.min(365, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
            score = score * (1.0 + 0.03 * (1 - ageInDays / 365));
          }
          if (m.is_latest === true) score = score * 1.02;
          if (args.query && m.content) {
            const boost = calculateKeywordBoost(args.query, m.content);
            score = score * (1.0 + (boost - 1.0) / 3);
          }

          return { ...m, score, is_latest: m.is_latest ?? true };
        })
        .filter((m: any) => m.score >= minScore)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit);
      
      console.log("[DEBUG] Returning", results.length, "results after similarity filter");
      return results;
    }

    // STANDARD VECTOR SEARCH when no containerTag
    const vectorResults = await ctx.vectorSearch("memories", "by_embedding", {
      vector: args.embedding,
      limit: Math.min(limit * 2, 256),
      filter: (q) => q.eq("user_id", args.userId),
    });

    const filteredIds = vectorResults.filter((r: any) => r._score >= minScore).map((r: any) => r._id);
    if (filteredIds.length === 0) return [];

    const memoryMap = await ctx.runQuery(internal.vectorSearch.getMemoriesByIds, { ids: filteredIds });

    let results = vectorResults
      .filter((r: any) => r._score >= minScore && memoryMap[r._id] && memoryMap[r._id].is_latest !== false && !memoryMap[r._id].is_forgotten)
      .map((r: any) => {
        const mem = memoryMap[r._id];
        let score = r._score;
        
        const updatedAt = mem.updated_at || mem.created_at || 0;
        if (updatedAt > 0) {
          const ageInDays = Math.min(365, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
          score = score * (1.0 + 0.03 * (1 - ageInDays / 365));
        }
        if (mem.is_latest === true) score = score * 1.02;
        if (args.query && mem.content) {
          const boost = calculateKeywordBoost(args.query, mem.content);
          score = score * (1.0 + (boost - 1.0) / 3);
        }

        return { ...mem, score, is_latest: mem.is_latest ?? true };
      });

    if (args.metadataFilters) {
      const filters = args.metadataFilters;
      results = results.filter((m: any) => {
        if (filters.category && m.category !== filters.category) return false;
        if (filters.type && m.type !== filters.type) return false;
        if (filters.isStatic !== undefined && m.is_static !== filters.isStatic) return false;
        return true;
      });
    }

    return results.slice(0, limit);
  },
});

// Combined search across all data types
export const searchAll = action({
  args: {
    userId: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    searchDocuments: v.optional(v.boolean()),
    searchChunks: v.optional(v.boolean()),
    searchMemories: v.optional(v.boolean()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minScore = args.minScore ?? 0.65;

    const [docResults, chunkResults, memoryResults] = await Promise.all([
      args.searchDocuments !== false
        ? ctx.vectorSearch("documents", "by_embedding", { vector: args.embedding, limit, filter: (q) => q.eq("user_id", args.userId) }).catch(() => [])
        : [],
      args.searchChunks !== false
        ? ctx.vectorSearch("document_chunks", "by_embedding", { vector: args.embedding, limit, filter: (q) => q.eq("user_id", args.userId) }).catch(() => [])
        : [],
      args.searchMemories !== false
        ? ctx.vectorSearch("memories", "by_embedding", { vector: args.embedding, limit: limit * 2, filter: (q) => q.eq("user_id", args.userId) }).catch(() => [])
        : [],
    ]);

    const docIds = docResults.filter((r: any) => r._score >= minScore).map((r: any) => r._id);
    const chunkIds = chunkResults.filter((r: any) => r._score >= minScore).map((r: any) => r._id);
    const memoryIds = memoryResults.filter((r: any) => r._score >= minScore).map((r: any) => r._id);

    const [docMap, chunkMap, memoryMap] = await Promise.all([
      docIds.length > 0 ? ctx.runQuery(internal.vectorSearch.getDocumentsByIds, { ids: docIds }) : {},
      chunkIds.length > 0 ? ctx.runQuery(internal.vectorSearch.getChunksByIds, { ids: chunkIds }) : {},
      memoryIds.length > 0 ? ctx.runQuery(internal.vectorSearch.getMemoriesByIds, { ids: memoryIds }) : {},
    ]);

    const results: any[] = [];

    for (const r of docResults) {
      if (r._score >= minScore && docMap[r._id]) {
        results.push({ type: "document", ...docMap[r._id], score: r._score });
      }
    }
    for (const r of chunkResults) {
      if (r._score >= minScore && chunkMap[r._id]) {
        results.push({ type: "chunk", ...chunkMap[r._id], score: r._score });
      }
    }
    for (const r of memoryResults) {
      if (r._score >= minScore && memoryMap[r._id] && memoryMap[r._id].is_latest !== false && !memoryMap[r._id].is_forgotten) {
        const mem = memoryMap[r._id];
        let score = r._score;
        const updatedAt = mem.updated_at || mem.created_at || 0;
        if (updatedAt > 0) {
          const ageInDays = Math.min(365, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
          score = score * (1.0 + 0.03 * (1 - ageInDays / 365));
        }
        if (mem.is_latest === true) score = score * 1.02;
        if (args.query && mem.content) {
          const boost = calculateKeywordBoost(args.query, mem.content);
          score = score * (1.0 + (boost - 1.0) / 3);
        }
        results.push({ type: "memory", ...mem, score, is_latest: mem.is_latest ?? true });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
});
