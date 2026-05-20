#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Mark Empty Chinese CSV Files for Re-crawl
 *
 * Scans for empty Chinese CSV files (.csv) and marks them in the checkpoint
 * for re-crawling.
 *
 * Usage:
 *   pnpm exec tsx src/sites/rongmotamhon.net/mark-empty-csv.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_CHECKPOINT_DIR, DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import type { Checkpoint } from '@/lib/crawler/checkpoint';

const CHECKPOINT_PATH = path.join(
  DEFAULT_CHECKPOINT_DIR,
  'RB-rongmotamhon.net-checkpoint.json',
);

const CORPUS_PATH = path.join(DEFAULT_OUTPUT_FILE_DIR, 'Z');

type EmptyCsvInfo = {
  documentId: string;
  chapterNumber: number;
  filePath: string;
};

type CheckpointParams = {
  documentId: string;
  title: string;
  [key: string]: unknown;
};

type SubtaskParams = {
  href: string;
  props: {
    chapterNumber: number;
    chapterName: string;
  };
};

/**
 * Check if CSV file is empty (0 bytes or only has header row)
 */
const isCsvEmpty = (filePath: string): boolean => {
  try {
    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      return true;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    // CSV is empty if it has only 1 line (header) or no lines
    return lines.length <= 1;
  } catch (error) {
    return false;
  }
};

/**
 * Find all empty Chinese CSV files
 */
const findEmptyCsvFiles = (): EmptyCsvInfo[] => {
  const emptyCsvFiles: EmptyCsvInfo[] = [];

  if (!fs.existsSync(CORPUS_PATH)) {
    console.warn(`WARNING: Corpus path does not exist: ${CORPUS_PATH}`);
    return emptyCsvFiles;
  }

  // Get all RBZ folders
  const folders = fs
    .readdirSync(CORPUS_PATH)
    .filter((name) => {
      const fullPath = path.join(CORPUS_PATH, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
    })
    .sort();

  console.log(`Scanning ${folders.length} folders for empty CSV files...\n`);

  // Process each folder
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const folderPath = path.join(CORPUS_PATH, folder);
    const files = fs.readdirSync(folderPath);

    // Check for empty .csv files (not _vie.csv)
    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      // Only check Chinese CSV files (not Vietnamese _vie.csv)
      if (file.endsWith('.csv') && !file.endsWith('_vie.csv')) {
        const filePath = path.join(folderPath, file);

        if (isCsvEmpty(filePath)) {
          // Extract documentId and chapter number from filename
          // Format: RBZ_XXX.YYY.csv
          const match = file.match(/^(RBZ_\d+)\.(\d+)\.csv$/);
          if (match) {
            const documentId = match[1]!;
            const chapterNumber = Number.parseInt(match[2]!, 10);

            emptyCsvFiles.push({
              documentId,
              chapterNumber,
              filePath: path.relative(CORPUS_PATH, filePath),
            });
          }
        }
      }
    }
  }

  return emptyCsvFiles;
};

/**
 * Mark checkpoints as incomplete for re-crawl
 */
const markCheckpointsForRecrawl = (
  emptyCsvFiles: EmptyCsvInfo[],
  dryRun: boolean,
): {
  updated: number;
  notFound: number;
  alreadyIncomplete: number;
} => {
  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.error(`ERROR: Checkpoint file not found: ${CHECKPOINT_PATH}`);
    return { updated: 0, notFound: 0, alreadyIncomplete: 0 };
  }

  // Load checkpoint
  const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
  const checkpoint: Checkpoint<CheckpointParams, SubtaskParams>[] =
    JSON.parse(raw);

  let updatedCount = 0;
  let notFoundCount = 0;
  let alreadyIncompleteCount = 0;

  console.log(`Processing ${emptyCsvFiles.length} empty CSV files...\n`);

  // Create a map of documentId -> task for quick lookup
  const checkpointMap = new Map<
    string,
    Checkpoint<CheckpointParams, SubtaskParams>
  >();
  // eslint-disable-next-line no-restricted-syntax
  for (const task of checkpoint) {
    checkpointMap.set(task.params.documentId, task);
  }

  // Process each empty CSV file
  // eslint-disable-next-line no-restricted-syntax
  for (const emptyFile of emptyCsvFiles) {
    const { documentId, chapterNumber, filePath } = emptyFile;
    const task = checkpointMap.get(documentId);

    if (!task) {
      console.warn(`  ✗ Not found in checkpoint: ${filePath}`);
      notFoundCount += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    // Find the subtask with matching chapter number
    let subtaskFound = false;
    if (task.subtasks) {
      // eslint-disable-next-line no-restricted-syntax
      for (const subtask of task.subtasks) {
        if (subtask.params.props.chapterNumber === chapterNumber) {
          subtaskFound = true;

          if (subtask.completed) {
            console.log(`  ✓ Marking as incomplete: ${filePath}`);
            if (!dryRun) {
              subtask.completed = false;
            }
            updatedCount += 1;
          } else {
            console.log(`  - Already incomplete: ${filePath}`);
            alreadyIncompleteCount += 1;
          }
          break;
        }
      }
    }

    if (!subtaskFound) {
      console.warn(`  ✗ Chapter not found in checkpoint: ${filePath}`);
      notFoundCount += 1;
    }
  }

  // Update parent task completion status
  if (!dryRun && updatedCount > 0) {
    // eslint-disable-next-line no-restricted-syntax
    for (const task of checkpoint) {
      if (task.subtasks) {
        const hasIncompleteSubtasks = task.subtasks.some((st) => !st.completed);
        if (hasIncompleteSubtasks) {
          task.completed = false;
        }
      }
    }

    // Save checkpoint with backup
    const backupPath = `${CHECKPOINT_PATH}.bak`;
    fs.copyFileSync(CHECKPOINT_PATH, backupPath);
    console.log(`\nCreated backup: ${backupPath}`);

    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
    console.log(`Updated checkpoint: ${CHECKPOINT_PATH}`);
  }

  return {
    updated: updatedCount,
    notFound: notFoundCount,
    alreadyIncomplete: alreadyIncompleteCount,
  };
};

/**
 * Main function
 */
const main = (): void => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  console.log('Finding empty Chinese CSV files...\n');

  const emptyCsvFiles = findEmptyCsvFiles();

  console.log(`\nFound ${emptyCsvFiles.length} empty Chinese CSV files\n`);

  if (emptyCsvFiles.length === 0) {
    console.log('No empty CSV files found. Nothing to do.\n');
    return;
  }

  // Show first 10 empty files
  console.log('Empty CSV files:');
  const showCount = Math.min(10, emptyCsvFiles.length);
  // eslint-disable-next-line no-restricted-syntax
  for (let i = 0; i < showCount; i += 1) {
    console.log(`  - ${emptyCsvFiles[i]!.filePath}`);
  }
  if (emptyCsvFiles.length > 10) {
    console.log(`  ... and ${emptyCsvFiles.length - 10} more\n`);
  }
  console.log();

  const { updated, notFound, alreadyIncomplete } = markCheckpointsForRecrawl(
    emptyCsvFiles,
    dryRun,
  );

  console.log('SUMMARY');
  console.log(`  Empty CSV files found:      ${emptyCsvFiles.length}`);
  console.log(`  Marked for re-crawl:        ${updated}`);
  console.log(`  Already incomplete:         ${alreadyIncomplete}`);
  console.log(`  Not found in checkpoint:    ${notFound}`);

  if (dryRun) {
    console.log('\nDRY RUN MODE - No changes were made');
    console.log('Run without --dry-run to apply changes\n');
  } else if (updated > 0) {
    console.log('\nRe-run the crawler to fetch the empty files:');
    console.log('  pnpm crawl --site rongmotamhon.net\n');
  } else if (alreadyIncomplete > 0) {
    console.log(
      '\nAll empty CSV files are already marked as incomplete in the checkpoint.\n',
    );
  }
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { findEmptyCsvFiles, markCheckpointsForRecrawl, isCsvEmpty };
