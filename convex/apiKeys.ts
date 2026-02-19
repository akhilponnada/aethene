import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

/**
 * API Keys - Authentication and rate limiting
 */

// Get API key by key value (for authentication)
export const getByKey = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("api_keys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

// Get all API keys for a user
export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("api_keys")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();
  },
});

// Create a new API key
export const create = mutation({
  args: {
    key: v.string(),
    userId: v.string(),
    name: v.optional(v.string()),
    rateLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("api_keys", {
      key: args.key,
      user_id: args.userId,
      name: args.name,
      rate_limit: args.rateLimit,
      monthly_limit: args.monthlyLimit,
      requests_this_month: 0,
      is_active: true,
      created_at: Date.now(),
    });
  },
});

// Validate API key and check rate limits
export const validate = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("api_keys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (!apiKey) {
      return { valid: false, error: "Invalid API key" };
    }

    if (!apiKey.is_active) {
      return { valid: false, error: "API key is inactive" };
    }

    if (apiKey.expires_at && apiKey.expires_at < Date.now()) {
      return { valid: false, error: "API key has expired" };
    }

    // Check monthly limit
    if (
      apiKey.monthly_limit &&
      (apiKey.requests_this_month ?? 0) >= apiKey.monthly_limit
    ) {
      return { valid: false, error: "Monthly request limit exceeded" };
    }

    return {
      valid: true,
      userId: apiKey.user_id,
      rateLimit: apiKey.rate_limit,
      monthlyLimit: apiKey.monthly_limit,
      requestsThisMonth: apiKey.requests_this_month ?? 0,
      // Scoped key fields
      isScoped: apiKey.is_scoped ?? false,
      containerTags: apiKey.container_tags ?? [],
      permissions: apiKey.permissions ?? ["read", "write", "delete", "admin"],
    };
  },
});

// Increment request count (call after each API request)
export const incrementRequests = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("api_keys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (apiKey) {
      await ctx.db.patch(apiKey._id, {
        requests_this_month: (apiKey.requests_this_month ?? 0) + 1,
        last_used_at: Date.now(),
      });
    }

    return { success: true };
  },
});

// Update API key
export const update = mutation({
  args: {
    id: v.id("api_keys"),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    rateLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};

    if (args.name !== undefined) updates.name = args.name;
    if (args.isActive !== undefined) updates.is_active = args.isActive;
    if (args.rateLimit !== undefined) updates.rate_limit = args.rateLimit;
    if (args.monthlyLimit !== undefined)
      updates.monthly_limit = args.monthlyLimit;
    if (args.expiresAt !== undefined) updates.expires_at = args.expiresAt;

    await ctx.db.patch(args.id, updates);
    return ctx.db.get(args.id);
  },
});

// Delete API key
export const remove = mutation({
  args: { id: v.id("api_keys") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Reset monthly request count (for billing cycle)
export const resetMonthlyUsage = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("api_keys")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    await Promise.all(
      keys.map((key) =>
        ctx.db.patch(key._id, {
          requests_this_month: 0,
        })
      )
    );

    return { reset: keys.length };
  },
});

// Get usage statistics
export const getUsageStats = query({
  args: { id: v.id("api_keys") },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.id);
    if (!apiKey) {
      return null;
    }

    return {
      requestsThisMonth: apiKey.requests_this_month ?? 0,
      monthlyLimit: apiKey.monthly_limit,
      rateLimit: apiKey.rate_limit,
      lastUsedAt: apiKey.last_used_at,
      isActive: apiKey.is_active,
      expiresAt: apiKey.expires_at,
    };
  },
});

// Regenerate API key (new key value, same settings)
export const regenerate = mutation({
  args: {
    id: v.id("api_keys"),
    newKey: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.id);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    await ctx.db.patch(args.id, {
      key: args.newKey,
      is_active: true,
      requests_this_month: 0,
      last_used_at: undefined,
    });

    return ctx.db.get(args.id);
  },
});

// =============================================================================
// SCOPED API KEYS (Supermemory v3 compatible)
// =============================================================================

// Create a scoped API key (child of parent key)
export const createScopedKey = mutation({
  args: {
    key: v.string(),
    parentKeyId: v.string(),
    userId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    containerTags: v.array(v.string()),
    permissions: v.array(v.string()),
    rateLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate permissions
    const validPermissions = ["read", "write", "delete", "admin"];
    for (const perm of args.permissions) {
      if (!validPermissions.includes(perm)) {
        throw new Error(`Invalid permission: ${perm}`);
      }
    }

    // Container tags are required for scoped keys
    if (args.containerTags.length === 0) {
      throw new Error("At least one containerTag is required for scoped keys");
    }

    return ctx.db.insert("api_keys", {
      key: args.key,
      user_id: args.userId,
      name: args.name,
      description: args.description,
      rate_limit: args.rateLimit,
      monthly_limit: args.monthlyLimit,
      requests_this_month: 0,
      is_active: true,
      created_at: Date.now(),
      expires_at: args.expiresAt,
      // Scoped key fields
      is_scoped: true,
      container_tags: args.containerTags,
      permissions: args.permissions,
      parent_key_id: args.parentKeyId,
    });
  },
});

// Get all scoped keys for a parent key
export const getScopedKeys = query({
  args: { parentKeyId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("api_keys")
      .withIndex("by_parent", (q) => q.eq("parent_key_id", args.parentKeyId))
      .collect();
  },
});

// Revoke a scoped key
export const revokeScopedKey = mutation({
  args: {
    id: v.id("api_keys"),
    parentUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.id);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    // Verify ownership - the parent user must own this key
    if (apiKey.user_id !== args.parentUserId) {
      throw new Error("Access denied: You don't own this API key");
    }

    // Only scoped keys can be revoked via this endpoint
    if (!apiKey.is_scoped) {
      throw new Error("This is not a scoped key");
    }

    await ctx.db.patch(args.id, {
      is_active: false,
    });

    return { success: true };
  },
});

// Update scoped key permissions/tags
export const updateScopedKey = mutation({
  args: {
    id: v.id("api_keys"),
    parentUserId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    containerTags: v.optional(v.array(v.string())),
    permissions: v.optional(v.array(v.string())),
    rateLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.id);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    // Verify ownership
    if (apiKey.user_id !== args.parentUserId) {
      throw new Error("Access denied: You don't own this API key");
    }

    if (!apiKey.is_scoped) {
      throw new Error("This is not a scoped key");
    }

    const updates: Record<string, any> = {};

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.containerTags !== undefined) {
      if (args.containerTags.length === 0) {
        throw new Error("At least one containerTag is required");
      }
      updates.container_tags = args.containerTags;
    }
    if (args.permissions !== undefined) {
      const validPermissions = ["read", "write", "delete", "admin"];
      for (const perm of args.permissions) {
        if (!validPermissions.includes(perm)) {
          throw new Error(`Invalid permission: ${perm}`);
        }
      }
      updates.permissions = args.permissions;
    }
    if (args.rateLimit !== undefined) updates.rate_limit = args.rateLimit;
    if (args.monthlyLimit !== undefined) updates.monthly_limit = args.monthlyLimit;
    if (args.expiresAt !== undefined) updates.expires_at = args.expiresAt;
    if (args.isActive !== undefined) updates.is_active = args.isActive;

    await ctx.db.patch(args.id, updates);
    return ctx.db.get(args.id);
  },
});

// =============================================================================
// INTERNAL MUTATIONS (FOR CRON JOBS)
// =============================================================================

/**
 * Reset monthly usage for ALL API keys.
 * Called by cron job on the 1st of each month.
 */
export const resetMonthlyUsageAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all API keys
    const allKeys = await ctx.db.query("api_keys").collect();

    // Reset each key's monthly usage
    await Promise.all(
      allKeys.map((key) =>
        ctx.db.patch(key._id, {
          requests_this_month: 0,
        })
      )
    );

    return {
      reset: allKeys.length,
      timestamp: Date.now(),
    };
  },
});
