/**
 * v3 Settings Routes for Aethene API
 * Supermemory v3 API compatible endpoints
 *
 * GET /v3/settings - Get current settings
 * PATCH /v3/settings - Update settings
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types/hono.js';
import { z } from 'zod';
import {
  authenticationError,
  internalError,
  validationError,
} from '../utils/errors.js';
import { query, mutation } from '../database/convex.js';

const settingsRoutes = new Hono<AppEnv>();

// =============================================================================
// SCHEMAS (Supermemory v3 compatible)
// =============================================================================

const GetSettingsQuerySchema = z.object({
  containerTag: z.string().optional(),
});

const UpdateSettingsSchema = z.object({
  shouldLLMFilter: z.boolean().optional(),
  filterPrompt: z.string().max(10000).optional(),
  chunkSize: z.number().min(100).max(10000).optional(),
  chunkOverlap: z.number().min(0).max(1000).optional(),
  entityContext: z.record(z.unknown()).optional(),
  connectorBranding: z.object({
    name: z.string().optional(),
    logo: z.string().url().optional(),
    color: z.string().optional(),
  }).optional(),
  containerTag: z.string().optional(),
  // Google Drive connector settings
  googleDriveCustomKeyEnabled: z.boolean().optional(),
  googleDriveClientId: z.string().optional(),
  googleDriveClientSecret: z.string().optional(),
  // Notion connector settings
  notionCustomKeyEnabled: z.boolean().optional(),
  notionClientId: z.string().optional(),
  notionClientSecret: z.string().optional(),
  // OneDrive connector settings
  onedriveCustomKeyEnabled: z.boolean().optional(),
  onedriveClientId: z.string().optional(),
  onedriveClientSecret: z.string().optional(),
});

// =============================================================================
// TYPES
// =============================================================================

interface SettingsRecord {
  _id: string;
  user_id: string;
  container_tag?: string;
  should_llm_filter?: boolean;
  filter_prompt?: string;
  chunk_size?: number;
  chunk_overlap?: number;
  entity_context?: Record<string, unknown>;
  connector_branding?: Record<string, unknown>;
  // Google Drive
  google_drive_custom_key_enabled?: boolean;
  google_drive_client_id?: string;
  google_drive_client_secret?: string;
  // Notion
  notion_custom_key_enabled?: boolean;
  notion_client_id?: string;
  notion_client_secret?: string;
  // OneDrive
  onedrive_custom_key_enabled?: boolean;
  onedrive_client_id?: string;
  onedrive_client_secret?: string;
  created_at: number;
  updated_at: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Transform database settings to API response format
 */
function formatSettingsResponse(settings: SettingsRecord | null) {
  if (!settings) {
    // Return default settings if none exist
    return {
      shouldLLMFilter: false,
      filterPrompt: null,
      chunkSize: -1,  // -1 means use default
      chunkOverlap: 200,
      entityContext: {},
      connectorBranding: null,
      containerTag: null,
      // Connector settings (hidden by default for security)
      googleDriveCustomKeyEnabled: false,
      googleDriveClientSecret: null,
      notionCustomKeyEnabled: false,
      notionClientSecret: null,
      onedriveCustomKeyEnabled: false,
      onedriveClientSecret: null,
      // GitHub connector settings
      githubClientId: null,
      githubClientSecret: null,
      githubCustomKeyEnabled: false,
      // Include/Exclude items
      excludeItems: [],
      includeItems: [],
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    shouldLLMFilter: settings.should_llm_filter ?? false,
    filterPrompt: settings.filter_prompt ?? null,
    chunkSize: settings.chunk_size ?? -1,
    chunkOverlap: settings.chunk_overlap ?? 200,
    entityContext: settings.entity_context ?? {},
    connectorBranding: settings.connector_branding ?? null,
    containerTag: settings.container_tag ?? null,
    // Connector settings - only return enabled status, not secrets
    googleDriveCustomKeyEnabled: settings.google_drive_custom_key_enabled ?? false,
    googleDriveClientId: settings.google_drive_client_id ?? null,
    googleDriveClientSecret: null,
    notionCustomKeyEnabled: settings.notion_custom_key_enabled ?? false,
    notionClientId: settings.notion_client_id ?? null,
    notionClientSecret: null,
    onedriveCustomKeyEnabled: settings.onedrive_custom_key_enabled ?? false,
    onedriveClientId: settings.onedrive_client_id ?? null,
    onedriveClientSecret: null,
    // GitHub connector settings
    githubClientId: null,
    githubClientSecret: null,
    githubCustomKeyEnabled: false,
    // Include/Exclude items
    excludeItems: [],
    includeItems: [],
    createdAt: settings.created_at ? new Date(settings.created_at).toISOString() : null,
    updatedAt: settings.updated_at ? new Date(settings.updated_at).toISOString() : null,
  };
}

// =============================================================================
// GET /v3/settings - Get current settings
// =============================================================================

settingsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  // Parse query parameters
  const queryParams = c.req.query();
  const parsed = GetSettingsQuerySchema.safeParse(queryParams);

  if (!parsed.success) {
    return validationError(c, 'Invalid query parameters');
  }

  const { containerTag } = parsed.data;

  try {
    const settings = await query<SettingsRecord | null>('settings:getByUser', {
      userId,
      containerTag,
    });

    return c.json(formatSettingsResponse(settings));
  } catch (error) {
    return internalError(c, error, 'get settings');
  }
});

// =============================================================================
// GET /v3/settings/all - Get all settings (including per-container)
// =============================================================================

settingsRoutes.get('/all', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  try {
    const allSettings = await query<SettingsRecord[]>('settings:getAllByUser', {
      userId,
    });

    return c.json({
      settings: allSettings.map(formatSettingsResponse),
      total: allSettings.length,
    });
  } catch (error) {
    return internalError(c, error, 'get all settings');
  }
});

// =============================================================================
// PATCH /v3/settings - Update settings
// =============================================================================

settingsRoutes.patch('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  let body: z.infer<typeof UpdateSettingsSchema>;
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = UpdateSettingsSchema.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return validationError(c, message);
  }

  // Check that at least one field is provided
  const hasUpdates =
    body.shouldLLMFilter !== undefined ||
    body.filterPrompt !== undefined ||
    body.chunkSize !== undefined ||
    body.chunkOverlap !== undefined ||
    body.entityContext !== undefined ||
    body.connectorBranding !== undefined ||
    body.googleDriveCustomKeyEnabled !== undefined ||
    body.googleDriveClientId !== undefined ||
    body.googleDriveClientSecret !== undefined ||
    body.notionCustomKeyEnabled !== undefined ||
    body.notionClientId !== undefined ||
    body.notionClientSecret !== undefined ||
    body.onedriveCustomKeyEnabled !== undefined ||
    body.onedriveClientId !== undefined ||
    body.onedriveClientSecret !== undefined;

  if (!hasUpdates) {
    return validationError(c, 'At least one setting field must be provided');
  }

  try {
    const updated = await mutation<SettingsRecord>('settings:upsert', {
      userId,
      containerTag: body.containerTag,
      shouldLLMFilter: body.shouldLLMFilter,
      filterPrompt: body.filterPrompt,
      chunkSize: body.chunkSize,
      chunkOverlap: body.chunkOverlap,
      entityContext: body.entityContext,
      connectorBranding: body.connectorBranding,
      // Google Drive
      googleDriveCustomKeyEnabled: body.googleDriveCustomKeyEnabled,
      googleDriveClientId: body.googleDriveClientId,
      googleDriveClientSecret: body.googleDriveClientSecret,
      // Notion
      notionCustomKeyEnabled: body.notionCustomKeyEnabled,
      notionClientId: body.notionClientId,
      notionClientSecret: body.notionClientSecret,
      // OneDrive
      onedriveCustomKeyEnabled: body.onedriveCustomKeyEnabled,
      onedriveClientId: body.onedriveClientId,
      onedriveClientSecret: body.onedriveClientSecret,
    });

    return c.json(formatSettingsResponse(updated));
  } catch (error) {
    return internalError(c, error, 'update settings');
  }
});

// =============================================================================
// DELETE /v3/settings - Delete settings (reset to defaults)
// =============================================================================

settingsRoutes.delete('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return authenticationError(c);
  }

  const queryParams = c.req.query();
  const containerTag = queryParams.containerTag;

  try {
    const result = await mutation<{ success: boolean; deleted: boolean }>('settings:remove', {
      userId,
      containerTag,
    });

    return c.json({
      success: true,
      message: result.deleted ? 'Settings deleted' : 'No settings found to delete',
      containerTag: containerTag ?? null,
    });
  } catch (error) {
    return internalError(c, error, 'delete settings');
  }
});

export default settingsRoutes;
