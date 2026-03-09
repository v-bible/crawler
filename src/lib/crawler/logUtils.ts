/**
 * Logging utilities with structured metadata for tracing and error recovery
 */

import { readFileSync } from 'fs';
import { type ChapterParams } from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

/**
 * Metadata for logging context
 */
export type LogContext = {
  documentId?: string;
  chapterNumber?: number;
  chapterName?: string;
  resourceHref?: string;
  metadata?: {
    title?: string;
    source?: string;
  };
};

/**
 * Extract log context from chapter params
 */
export function getLogContext(
  chapterParams: ChapterParams,
  metadata?: { title?: string; source?: string },
  resourceHref?: string,
): LogContext {
  return {
    documentId: `${chapterParams.domain}${chapterParams.subDomain}${chapterParams.genre}_${String(chapterParams.documentNumber).padStart(3, '0')}`,
    chapterNumber: chapterParams.chapterNumber,
    chapterName: chapterParams.chapterName,
    resourceHref,
    metadata: metadata
      ? {
          title: metadata.title,
          source: metadata.source,
        }
      : undefined,
  };
}

/**
 * Log info with context
 */
export function logInfo(message: string, context: LogContext): void {
  logger.info(message, context);
}

/**
 * Log error with context
 */
export function logError(
  message: string,
  context: LogContext,
  error?: unknown,
): void {
  logger.error(message, {
    ...context,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Log warning with context
 */
export function logWarn(message: string, context: LogContext): void {
  logger.warn(message, context);
}

/**
 * Parse errors from log file
 */
export type LogError = {
  timestamp: string;
  message: string;
  documentId?: string;
  chapterNumber?: number;
  resourceHref?: string;
  error?: string;
};

/**
 * Parse log file and extract errors with context
 */
export function parseLogErrors(logFilePath: string): LogError[] {
  const errors: LogError[] = [];

  try {
    const logContent = readFileSync(logFilePath, 'utf-8');
    const lines = logContent.split('\n').filter((line) => line.trim());

    // eslint-disable-next-line no-restricted-syntax
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.level === 'error') {
          errors.push({
            timestamp: entry.timestamp,
            message: entry.message,
            documentId: entry.documentId,
            chapterNumber: entry.chapterNumber,
            resourceHref: entry.resourceHref,
            error: entry.error,
          });
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }
  } catch (error) {
    logger.error(`Failed to read log file ${logFilePath}:`, error);
  }

  return errors;
}

/**
 * Group errors by document
 */
export function groupErrorsByDocument(
  errors: LogError[],
): Map<string, LogError[]> {
  const grouped = new Map<string, LogError[]>();

  // eslint-disable-next-line no-restricted-syntax
  for (const error of errors) {
    if (error.documentId) {
      if (!grouped.has(error.documentId)) {
        grouped.set(error.documentId, []);
      }
      grouped.get(error.documentId)!.push(error);
    }
  }

  return grouped;
}

/**
 * Extract document and chapter identifiers that need re-crawl
 */
export function extractFailedCheckpoints(
  errors: LogError[],
): Map<string, Set<number>> {
  const needsRecrawl = new Map<string, Set<number>>();

  // eslint-disable-next-line no-restricted-syntax
  for (const error of errors) {
    if (error.documentId) {
      if (!needsRecrawl.has(error.documentId)) {
        needsRecrawl.set(error.documentId, new Set());
      }
      if (error.chapterNumber !== undefined) {
        needsRecrawl.get(error.documentId)!.add(error.chapterNumber);
      }
    }
  }

  return needsRecrawl;
}
