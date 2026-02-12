import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import * as lockfile from 'proper-lockfile';
import type { Checkpoint } from '@/lib/crawler/checkpoint';
import { logger } from '@/logger/logger';

/**
 * Safely read checkpoint file with file locking
 */
export const readCheckpointFile = async <
  T extends Record<string, unknown>,
  K extends Record<string, unknown>,
>(
  filePath: string,
): Promise<Checkpoint<T, K>[]> => {
  let release: (() => Promise<void>) | null = null;

  try {
    // Wait for lock with retry
    release = await lockfile.lock(filePath, {
      retries: {
        retries: 10,
        minTimeout: 100,
        maxTimeout: 2000,
      },
      stale: 10000, // Consider lock stale after 10 seconds
    });

    const checkpointFileData = readFileSync(filePath, 'utf-8');
    return JSON.parse(checkpointFileData || '[]') as Checkpoint<T, K>[];
  } catch (error) {
    logger.error('Error reading checkpoint file with lock:', error);
    // Fallback to reading without lock if locking fails
    const checkpointFileData = readFileSync(filePath, 'utf-8');
    return JSON.parse(checkpointFileData || '[]') as Checkpoint<T, K>[];
  } finally {
    if (release) {
      await release();
    }
  }
};

/**
 * Safely write checkpoint file with file locking
 */
export const writeCheckpointFile = async <
  T extends Record<string, unknown>,
  K extends Record<string, unknown>,
>(
  filePath: string,
  data: Checkpoint<T, K>[],
): Promise<void> => {
  let release: (() => Promise<void>) | null = null;

  try {
    // Wait for lock with retry
    release = await lockfile.lock(filePath, {
      retries: {
        retries: 10,
        minTimeout: 100,
        maxTimeout: 2000,
      },
      stale: 10000,
    });

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Error writing checkpoint file with lock:', error);
    throw error;
  } finally {
    if (release) {
      await release();
    }
  }
};
