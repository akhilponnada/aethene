import { v } from "convex/values";
import { query } from "./_generated/server";

export const testContainerTag = query({
  args: {
    userId: v.string(),
    containerTag: v.string(),
  },
  handler: async (ctx, args) => {
    // Simple query without filters - get all memories (ordered desc like search does)
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .order("desc")
      .take(500);

    console.log("Total memories for user:", memories.length);

    // Debug: show what containerTags exist
    const allTags = new Set<string>();
    let withTags = 0;
    let withoutTags = 0;
    for (const m of memories) {
      const tags = (m as any).container_tags || [];
      if (tags.length > 0) {
        withTags++;
        tags.forEach((t: string) => allTags.add(t));
      } else {
        withoutTags++;
      }
    }
    console.log("Memories with tags:", withTags, "without tags:", withoutTags);
    console.log("Unique tags found:", Array.from(allTags));

    // Filter by containerTag
    const filtered = memories.filter((m: any) => {
      const tags = m.container_tags || [];
      return tags.includes(args.containerTag);
    });

    console.log("Filtered by containerTag:", filtered.length);

    return filtered.map((m: any) => ({
      content: m.content?.slice(0, 50),
      container_tags: m.container_tags,
    }));
  },
});

export const listUniqueUserIds = query({
  args: {},
  handler: async (ctx) => {
    const memories = await ctx.db.query("memories").take(200);
    const userIds = new Set<string>();
    for (const m of memories) {
      if (m.user_id) userIds.add(m.user_id);
    }
    return Array.from(userIds);
  },
});

export const checkEmbeddings = query({
  args: { userId: v.string(), containerTag: v.string() },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .take(100);
    const filtered = memories.filter((m: any) => {
      const tags = m.container_tags || [];
      return tags.includes(args.containerTag);
    });
    return filtered.map((m: any) => ({
      content: m.content?.slice(0, 50),
      hasEmbedding: !!(m.embedding && m.embedding.length > 0),
      embeddingLength: m.embedding?.length || 0,
    }));
  },
});
