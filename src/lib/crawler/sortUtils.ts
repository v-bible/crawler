import type { Checkpoint } from '@/lib/crawler/checkpoint';
import type { Metadata } from '@/lib/crawler/schema';

/**
 * Sort checkpoint in ascending order (top-to-bottom)
 * Processes documents from lowest to highest document number
 * This is the same as defaultSortCheckpoint
 */
export const sortCheckpointAsc = (
  a: Checkpoint<Metadata>,
  b: Checkpoint<Metadata>,
): number => {
  // Sort by requiresManualCheck (false first), then by document number
  const manualCheckDiff =
    Number(a.params.requiresManualCheck === true) -
    Number(b.params.requiresManualCheck === true);

  if (manualCheckDiff !== 0) return manualCheckDiff;

  return Number(a.params.documentNumber) - Number(b.params.documentNumber);
};

/**
 * Sort checkpoint in descending order (bottom-to-top)
 * Processes documents from highest to lowest document number
 */
export const sortCheckpointDesc = (
  a: Checkpoint<Metadata>,
  b: Checkpoint<Metadata>,
): number => {
  // Sort by requiresManualCheck (false first), then by document number (descending)
  const manualCheckDiff =
    Number(a.params.requiresManualCheck === true) -
    Number(b.params.requiresManualCheck === true);

  if (manualCheckDiff !== 0) return manualCheckDiff;

  return Number(b.params.documentNumber) - Number(a.params.documentNumber);
};
