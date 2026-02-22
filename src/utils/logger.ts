/**
 * Structured Logger for Aethene
 *
 * Provides JSON-formatted logging for production observability.
 * Compatible with common log aggregation tools (Datadog, Splunk, ELK).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  userId?: string;
  endpoint?: string;
  method?: string;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
  stack?: string;
  [key: string]: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= CURRENT_LEVEL;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();

  if (IS_PRODUCTION) {
    // JSON format for production (log aggregation)
    return JSON.stringify({
      timestamp,
      level,
      message,
      service: 'aethene',
      version: '1.0.0',
      ...context,
    });
  }

  // Human-readable format for development
  const contextStr = context
    ? ' ' + Object.entries(context)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ')
    : '';

  const levelColors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m',  // Green
    warn: '\x1b[33m',  // Yellow
    error: '\x1b[31m', // Red
  };
  const reset = '\x1b[0m';

  return `${levelColors[level]}[${level.toUpperCase()}]${reset} ${timestamp} ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      console.log(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      console.log(formatLog('info', message, context));
    }
  },

  warn(message: string, context?: LogContext): void {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', message, context));
    }
  },

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (shouldLog('error')) {
      const errorContext: LogContext = {
        ...context,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      console.error(formatLog('error', message, errorContext));
    }
  },

  // Request logging helper
  request(req: {
    method: string;
    path: string;
    requestId?: string;
    userId?: string;
  }): void {
    this.info('Request received', {
      method: req.method,
      endpoint: req.path,
      requestId: req.requestId,
      userId: req.userId,
    });
  },

  // Response logging helper
  response(res: {
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
    requestId?: string;
    userId?: string;
  }): void {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    this[level]('Response sent', {
      method: res.method,
      endpoint: res.path,
      statusCode: res.statusCode,
      latencyMs: res.latencyMs,
      requestId: res.requestId,
      userId: res.userId,
    });
  },

  // Memory operation logging
  memoryOp(operation: string, context: LogContext): void {
    this.info(`Memory: ${operation}`, context);
  },

  // Search operation logging
  searchOp(query: string, results: number, latencyMs: number, context?: LogContext): void {
    this.info('Search completed', {
      query: query.slice(0, 100), // Truncate for log
      resultCount: results,
      latencyMs,
      ...context,
    });
  },

  // Database operation logging
  dbOp(operation: string, table: string, latencyMs: number, context?: LogContext): void {
    this.debug(`DB: ${operation}`, {
      table,
      latencyMs,
      ...context,
    });
  },

  // External API call logging
  externalApi(service: string, operation: string, latencyMs: number, success: boolean, context?: LogContext): void {
    const level = success ? 'debug' : 'warn';
    this[level](`External API: ${service}`, {
      operation,
      latencyMs,
      success,
      ...context,
    });
  },
};

export default logger;
