import type { Checkpoint } from '@/lib/crawler/checkpoint';
import type { Metadata } from '@/lib/crawler/schema';

/**
 * Default filter that returns incomplete checkpoints
 */
export const defaultFilterCheckpoint = <T extends Record<string, unknown>>(
  checkpoint: Checkpoint<T>,
): boolean => {
  return !checkpoint.completed;
};

/**
 * Filter for checkpoints without chapters (single-page documents)
 */
export const filterNonChapterCheckpoint = (
  checkpoint: Checkpoint<Metadata>,
): boolean => {
  return !checkpoint.completed && !checkpoint.params.hasChapters;
};

/**
 * Filter for checkpoints with chapters (multi-chapter documents)
 */
export const filterChapterCheckpoint = (
  checkpoint: Checkpoint<Metadata>,
): boolean => {
  return !checkpoint.completed && checkpoint.params.hasChapters === true;
};
