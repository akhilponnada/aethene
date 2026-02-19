/**
 * Error Handling Utilities for Aethene API
 *
 * Consistent error format: { error: string, code: string, details?: any }
 */

import { Context } from 'hono';
import { ZodError } from 'zod';

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST';

/**
 * Custom error class for validation errors
 * Global error handler catches this and returns 400
 */
export class ValidationError extends Error {
  code: ErrorCode = 'VALIDATION_ERROR';
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * Format an error response
 */
export function formatError(
  error: string,
  code: ErrorCode,
  details?: unknown
): ApiError {
  const response: ApiError = { error, code };
  if (details !== undefined) {
    response.details = details;
  }
  return response;
}

/**
 * Validation error (400)
 */
export function validationError(c: Context, message: string, details?: unknown) {
  return c.json(formatError(message, 'VALIDATION_ERROR', details), 400);
}

/**
 * Bad request error (400)
 */
export function badRequest(c: Context, message: string) {
  return c.json(formatError(message, 'BAD_REQUEST'), 400);
}

/**
 * Authentication error (401)
 */
export function authenticationError(c: Context, message = 'Authentication required') {
  return c.json(formatError(message, 'AUTHENTICATION_ERROR'), 401);
}

/**
 * Authorization error (403)
 */
export function authorizationError(c: Context, message = 'Access denied') {
  return c.json(formatError(message, 'AUTHORIZATION_ERROR'), 403);
}

/**
 * Not found error (404)
 */
export function notFoundError(c: Context, resource = 'Resource') {
  return c.json(formatError(`${resource} not found`, 'NOT_FOUND'), 404);
}

/**
 * Conflict error (409)
 */
export function conflictError(c: Context, message: string) {
  return c.json(formatError(message, 'CONFLICT'), 409);
}

/**
 * Internal error (500) - sanitizes error messages
 * SECURITY: Never leaks error details in production
 */
export function internalError(c: Context, error: unknown, context?: string) {
  // Always log the full error for debugging (server-side only)
  console.error(`[API Error]${context ? ` ${context}:` : ''}`, error);

  // SECURITY: In production, NEVER expose internal error details to clients
  // Only show generic message to prevent information leakage
  if (process.env.NODE_ENV === 'production') {
    return c.json(formatError('Internal server error', 'INTERNAL_ERROR'), 500);
  }

  // In development, include error details for debugging
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return c.json(
    formatError('Internal server error', 'INTERNAL_ERROR', message),
    500
  );
}

// =============================================================================
// SAFE ERROR MESSAGE EXTRACTION
// =============================================================================

/**
 * List of error message patterns that are safe to expose to clients.
 * These are user-facing validation/business logic errors, not internal errors.
 */
const SAFE_ERROR_PATTERNS = [
  'not found',
  'already exists',
  'Access denied',
  'Invalid',
  'Required',
  'too large',
  'too long',
  'too short',
  'Maximum',
  'Minimum',
  'Unsupported',
  'identical',
  'forgotten',
  'permission',
  'containerTag',
  'not a scoped key',
];

/**
 * Safely extract error message for client response.
 * SECURITY: Only returns the message if it matches known safe patterns.
 * In production, unknown errors return a generic message.
 *
 * @param error - The caught error
 * @param fallback - Fallback message if error is not safe to expose
 */
export function getSafeErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message;

  // Check if the error message matches any safe pattern
  const isSafe = SAFE_ERROR_PATTERNS.some(pattern =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );

  if (isSafe) {
    return message;
  }

  // In development, expose all messages for debugging
  if (process.env.NODE_ENV !== 'production') {
    return message;
  }

  // In production, use fallback for unknown error types
  return fallback;
}

// =============================================================================
// ZOD ERROR HANDLING
// =============================================================================

/**
 * Format Zod validation errors into readable messages
 */
export function formatZodError(error: ZodError): { message: string; details: unknown[] } {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));

  const firstError = error.errors[0];
  const message = firstError
    ? `${firstError.path.join('.')} - ${firstError.message}`
    : 'Validation failed';

  return { message, details };
}

/**
 * Handle Zod validation and return error response if invalid
 */
export function handleZodError(c: Context, error: ZodError) {
  const { message, details } = formatZodError(error);
  return validationError(c, message, details);
}

// =============================================================================
// REQUEST VALIDATION HELPER
// =============================================================================

import { z, ZodSchema } from 'zod';

/**
 * Validate request body with Zod schema
 * Returns validated data or throws ValidationError.
 *
 * JSON parse errors and validation errors propagate to global error handler (returns 400).
 */
export async function validateBody<T extends ZodSchema>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  // Let JSON parse errors propagate to global error handler for proper 400 response
  const body = await c.req.json();
  const result = schema.safeParse(body);

  if (!result.success) {
    const { message, details } = formatZodError(result.error);
    throw new ValidationError(message, details);
  }

  return result.data;
}

/**
 * Validate query parameters with Zod schema
 * Throws ValidationError if validation fails.
 */
export function validateQuery<T extends ZodSchema>(
  c: Context,
  schema: T
): z.infer<T> {
  const query = c.req.query();
  const result = schema.safeParse(query);

  if (!result.success) {
    const { message, details } = formatZodError(result.error);
    throw new ValidationError(message, details);
  }

  return result.data;
}
