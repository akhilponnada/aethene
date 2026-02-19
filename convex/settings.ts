import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Settings - User/container configuration (Supermemory v3 compatible)
 *
 * Supports:
 * - shouldLLMFilter: Enable/disable LLM filtering
 * - filterPrompt: Custom prompt for LLM filtering
 * - chunkSize: Default chunk size for document processing
 * - entityContext: Custom context per entity type (per containerTag)
 * - Connector settings: Google Drive, Notion, OneDrive custom OAuth
 */

// =============================================================================
// GET SETTINGS
// =============================================================================

/**
 * Get settings for a user (global or per container)
 */
export const getByUser = query({
  args: {
    userId: v.string(),
    containerTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // If containerTag is provided, try to get container-specific settings first
    if (args.containerTag) {
      const containerSettings = await ctx.db
        .query("settings")
        .withIndex("by_user_container", (q) =>
          q.eq("user_id", args.userId).eq("container_tag", args.containerTag)
        )
        .first();

      if (containerSettings) {
        return containerSettings;
      }
    }

    // Fall back to global user settings (no containerTag)
    return ctx.db
      .query("settings")
      .withIndex("by_user_container", (q) =>
        q.eq("user_id", args.userId).eq("container_tag", undefined)
      )
      .first();
  },
});

/**
 * Get all settings for a user (including all container-specific settings)
 */
export const getAllByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();
  },
});

// =============================================================================
// UPDATE SETTINGS
// =============================================================================

/**
 * Update or create settings for a user
 */
export const upsert = mutation({
  args: {
    userId: v.string(),
    containerTag: v.optional(v.string()),
    shouldLLMFilter: v.optional(v.boolean()),
    filterPrompt: v.optional(v.string()),
    chunkSize: v.optional(v.number()),
    chunkOverlap: v.optional(v.number()),
    entityContext: v.optional(v.any()),
    connectorBranding: v.optional(v.any()),
    // Google Drive connector
    googleDriveCustomKeyEnabled: v.optional(v.boolean()),
    googleDriveClientId: v.optional(v.string()),
    googleDriveClientSecret: v.optional(v.string()),
    // Notion connector
    notionCustomKeyEnabled: v.optional(v.boolean()),
    notionClientId: v.optional(v.string()),
    notionClientSecret: v.optional(v.string()),
    // OneDrive connector
    onedriveCustomKeyEnabled: v.optional(v.boolean()),
    onedriveClientId: v.optional(v.string()),
    onedriveClientSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if settings already exist
    const existing = args.containerTag
      ? await ctx.db
          .query("settings")
          .withIndex("by_user_container", (q) =>
            q.eq("user_id", args.userId).eq("container_tag", args.containerTag)
          )
          .first()
      : await ctx.db
          .query("settings")
          .withIndex("by_user_container", (q) =>
            q.eq("user_id", args.userId).eq("container_tag", undefined)
          )
          .first();

    if (existing) {
      // Update existing settings
      const updates: Record<string, unknown> = { updated_at: now };

      if (args.shouldLLMFilter !== undefined) {
        updates.should_llm_filter = args.shouldLLMFilter;
      }
      if (args.filterPrompt !== undefined) {
        updates.filter_prompt = args.filterPrompt;
      }
      if (args.chunkSize !== undefined) {
        updates.chunk_size = args.chunkSize;
      }
      if (args.chunkOverlap !== undefined) {
        updates.chunk_overlap = args.chunkOverlap;
      }
      if (args.entityContext !== undefined) {
        updates.entity_context = args.entityContext;
      }
      if (args.connectorBranding !== undefined) {
        updates.connector_branding = args.connectorBranding;
      }
      // Google Drive
      if (args.googleDriveCustomKeyEnabled !== undefined) {
        updates.google_drive_custom_key_enabled = args.googleDriveCustomKeyEnabled;
      }
      if (args.googleDriveClientId !== undefined) {
        updates.google_drive_client_id = args.googleDriveClientId;
      }
      if (args.googleDriveClientSecret !== undefined) {
        updates.google_drive_client_secret = args.googleDriveClientSecret;
      }
      // Notion
      if (args.notionCustomKeyEnabled !== undefined) {
        updates.notion_custom_key_enabled = args.notionCustomKeyEnabled;
      }
      if (args.notionClientId !== undefined) {
        updates.notion_client_id = args.notionClientId;
      }
      if (args.notionClientSecret !== undefined) {
        updates.notion_client_secret = args.notionClientSecret;
      }
      // OneDrive
      if (args.onedriveCustomKeyEnabled !== undefined) {
        updates.onedrive_custom_key_enabled = args.onedriveCustomKeyEnabled;
      }
      if (args.onedriveClientId !== undefined) {
        updates.onedrive_client_id = args.onedriveClientId;
      }
      if (args.onedriveClientSecret !== undefined) {
        updates.onedrive_client_secret = args.onedriveClientSecret;
      }

      await ctx.db.patch(existing._id, updates);
      return ctx.db.get(existing._id);
    } else {
      // Create new settings
      const id = await ctx.db.insert("settings", {
        user_id: args.userId,
        container_tag: args.containerTag,
        should_llm_filter: args.shouldLLMFilter,
        filter_prompt: args.filterPrompt,
        chunk_size: args.chunkSize,
        chunk_overlap: args.chunkOverlap,
        entity_context: args.entityContext,
        connector_branding: args.connectorBranding,
        // Google Drive
        google_drive_custom_key_enabled: args.googleDriveCustomKeyEnabled,
        google_drive_client_id: args.googleDriveClientId,
        google_drive_client_secret: args.googleDriveClientSecret,
        // Notion
        notion_custom_key_enabled: args.notionCustomKeyEnabled,
        notion_client_id: args.notionClientId,
        notion_client_secret: args.notionClientSecret,
        // OneDrive
        onedrive_custom_key_enabled: args.onedriveCustomKeyEnabled,
        onedrive_client_id: args.onedriveClientId,
        onedrive_client_secret: args.onedriveClientSecret,
        created_at: now,
        updated_at: now,
      });
      return ctx.db.get(id);
    }
  },
});

// =============================================================================
// DELETE SETTINGS
// =============================================================================

/**
 * Delete settings for a user (global or per container)
 */
export const remove = mutation({
  args: {
    userId: v.string(),
    containerTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const settings = args.containerTag
      ? await ctx.db
          .query("settings")
          .withIndex("by_user_container", (q) =>
            q.eq("user_id", args.userId).eq("container_tag", args.containerTag)
          )
          .first()
      : await ctx.db
          .query("settings")
          .withIndex("by_user_container", (q) =>
            q.eq("user_id", args.userId).eq("container_tag", undefined)
          )
          .first();

    if (settings) {
      await ctx.db.delete(settings._id);
      return { success: true, deleted: true };
    }

    return { success: true, deleted: false };
  },
});

/**
 * Delete all settings for a user
 */
export const removeAll = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const allSettings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    await Promise.all(allSettings.map((s) => ctx.db.delete(s._id)));

    return { success: true, deleted: allSettings.length };
  },
});
