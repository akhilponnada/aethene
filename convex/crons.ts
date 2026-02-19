import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled Jobs for Aethene
 *
 * Cron jobs for automatic maintenance tasks:
 * - Memory cleanup (expired memories)
 * - Monthly usage reset
 */

const crons = cronJobs();

// =============================================================================
// MEMORY CLEANUP
// =============================================================================

/**
 * Clean up expired memories every hour
 * Memories with expires_at in the past will be soft-deleted (marked forgotten)
 */
crons.hourly(
  "cleanup-expired-memories",
  { minuteUTC: 0 },
  internal.memoryOps.cleanupExpiredMemories
);

// =============================================================================
// API KEY USAGE RESET
// =============================================================================

/**
 * Reset monthly API key usage counters on the 1st of each month
 */
crons.monthly(
  "reset-api-key-usage",
  { day: 1, hourUTC: 0, minuteUTC: 0 },
  internal.apiKeys.resetMonthlyUsageAll
);

export default crons;
