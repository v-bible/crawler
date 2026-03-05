/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { DEFAULT_CHECKPOINT_DIR, DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import type { Checkpoint } from '@/lib/crawler/checkpoint';

const CHECKPOINT_PATH = path.join(
  DEFAULT_CHECKPOINT_DIR,
  'RB-rongmotamhon.net-checkpoint.json',
);

const CORPUS_PATH = path.join(DEFAULT_OUTPUT_FILE_DIR, 'Z');

type MissingFile = {
  documentId: string;
  chapterNumber: number;
  missingFiles: string[];
};

type OrphanedChapter = {
  documentId: string;
  chapterNumber: number;
  missingFiles: string[];
};

type EmptyFile = {
  documentId: string;
  chapterNumber: number;
  file: string;
  size: number;
};

type DuplicateFolder = {
  documentId: string;
  folders: string[];
  checkpointTitle: string;
  matchingFolder: string | null;
  nonMatchingFolders: string[];
};

type FileTypeCounts = {
  [extension: string]: number;
};

type CheckpointParams = {
  documentId: string;
  documentNumber: number;
  genre: { code: string; category: string; vietnamese: string };
  tags: string[];
  title: string;
  volume: string;
  author: string;
  sourceType: string;
  sourceURL: string;
  source: string;
  hasChapters: boolean;
  period: string;
  publishedTime: string;
  language: string;
  requiresManualCheck: boolean;
  note: string;
};

type SubtaskParams = {
  href: string;
  props: {
    chapterNumber: number;
    chapterName: string;
  };
};

const findDuplicateFolders = (): DuplicateFolder[] => {
  if (!fs.existsSync(CORPUS_PATH)) {
    console.warn(`WARNING: Corpus path does not exist: ${CORPUS_PATH}`);
    return [];
  }

  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.warn(`WARNING: Checkpoint file not found: ${CHECKPOINT_PATH}`);
    console.warn('Cannot verify titles without checkpoint');
    return [];
  }

  // Load checkpoint to get correct titles
  const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
  const checkpoint: Checkpoint<CheckpointParams, SubtaskParams>[] =
    JSON.parse(raw);

  // Create a map of documentId -> title from checkpoint
  const checkpointTitles = new Map<string, string>();
  // eslint-disable-next-line no-restricted-syntax
  for (const task of checkpoint) {
    checkpointTitles.set(task.params.documentId, task.params.title);
  }

  // Get all RBZ folders
  const folders = fs
    .readdirSync(CORPUS_PATH)
    .filter((name) => {
      const fullPath = path.join(CORPUS_PATH, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
    })
    .sort();

  // Group folders by documentId
  const foldersByDocId = new Map<string, string[]>();
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const documentId = folder.split(' ')[0]; // Extract RBZ_XXX from "RBZ_XXX (Title)"
    if (documentId) {
      if (!foldersByDocId.has(documentId)) {
        foldersByDocId.set(documentId, []);
      }
      foldersByDocId.get(documentId)?.push(folder);
    }
  }

  // Find duplicates (documentIds with more than one folder)
  const duplicates: DuplicateFolder[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const [documentId, folderList] of foldersByDocId) {
    if (folderList.length > 1) {
      const checkpointTitle = checkpointTitles.get(documentId) || '';
      const expectedFolderName = `${documentId} (${checkpointTitle})`;

      // Find which folder matches the checkpoint title
      const matchingFolder = folderList.find(
        (folder) => folder === expectedFolderName,
      );
      const nonMatchingFolders = folderList.filter(
        (folder) => folder !== expectedFolderName,
      );

      duplicates.push({
        documentId,
        folders: folderList,
        checkpointTitle,
        matchingFolder: matchingFolder || null,
        nonMatchingFolders,
      });
    }
  }

  return duplicates;
};

const getFileType = (filename: string): string => {
  // Check for Vietnamese CSV files
  if (filename.endsWith('_vie.csv')) {
    return '_vie.csv';
  }

  // Check for specific PDF files
  if (filename.endsWith('_can-long.pdf')) {
    return '_can-long.pdf';
  }
  if (filename.endsWith('_vinh-lac.pdf')) {
    return '_vinh-lac.pdf';
  }

  // Check for Chinese CSV files (ends with .csv but not _vie.csv)
  if (filename.endsWith('.csv')) {
    return '.csv (Chinese)';
  }

  // Default to extension
  return path.extname(filename);
};

const countFileTypes = (): {
  existing: FileTypeCounts;
  missing: FileTypeCounts;
} => {
  const existing: FileTypeCounts = {};
  const missing: FileTypeCounts = {};

  if (!fs.existsSync(CORPUS_PATH)) {
    return { existing, missing };
  }

  // Get all RBZ folders
  const folders = fs.readdirSync(CORPUS_PATH).filter((name) => {
    const fullPath = path.join(CORPUS_PATH, name);
    return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
  });

  // Count existing files
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const folderPath = path.join(CORPUS_PATH, folder);
    const files = fs.readdirSync(folderPath);

    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const fileType = getFileType(file);
      if (fileType) {
        existing[fileType] = (existing[fileType] || 0) + 1;
      }
    }
  }

  return { existing, missing };
};

const countMissingFileTypes = (missingFiles: MissingFile[]): FileTypeCounts => {
  const counts: FileTypeCounts = {};

  // eslint-disable-next-line no-restricted-syntax
  for (const item of missingFiles) {
    // eslint-disable-next-line no-restricted-syntax
    for (const file of item.missingFiles) {
      // Skip orphan markers and "ALL FILES MISSING" messages
      if (file.startsWith('[ORPHAN]') || file.includes('ALL FILES MISSING')) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const fileType = getFileType(file);
      if (fileType) {
        counts[fileType] = (counts[fileType] || 0) + 1;
      }
    }
  }

  return counts;
};

const findMissingFiles = (): MissingFile[] => {
  const missingFiles: MissingFile[] = [];

  if (!fs.existsSync(CORPUS_PATH)) {
    console.warn(`WARNING: Corpus path does not exist: ${CORPUS_PATH}`);
    return missingFiles;
  }

  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.warn(`WARNING: Checkpoint file not found: ${CHECKPOINT_PATH}`);
    console.warn('Cannot check for orphaned files without checkpoint');
    return missingFiles;
  }

  // Get all RBZ folders
  const folders = fs
    .readdirSync(CORPUS_PATH)
    .filter((name) => {
      const fullPath = path.join(CORPUS_PATH, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
    })
    .sort();

  console.log(`Found ${folders.length} RBZ folders to check\n`);

  // Load checkpoint to check for orphaned files
  const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
  const checkpoint: Checkpoint<CheckpointParams, SubtaskParams>[] =
    JSON.parse(raw);

  // Create a set of valid (documentId, chapterNumber) pairs from checkpoint
  const validChapters = new Set<string>();
  // eslint-disable-next-line no-restricted-syntax
  for (const task of checkpoint) {
    const { documentId } = task.params;
    if (task.subtasks) {
      // eslint-disable-next-line no-restricted-syntax
      for (const subtask of task.subtasks) {
        const key = `${documentId}:${subtask.params.props.chapterNumber}`;
        validChapters.add(key);
      }
    }
  }

  // Check each folder for missing files
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const folderPath = path.join(CORPUS_PATH, folder);
    const documentId = folder.split(' ')[0]; // Extract RBZ_XXX from "RBZ_XXX (Title)"

    if (documentId) {
      // Get all files in the folder
      const files = fs.readdirSync(folderPath);

      // Extract unique chapter numbers from files
      const chapterNumbers = new Set<number>();
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        const match = file.match(/^RBZ_\d+\.(\d+)/);
        if (match?.[1]) {
          chapterNumbers.add(Number.parseInt(match[1], 10));
        }
      }

      // If no chapters found in files, check if the folder should have any
      if (chapterNumbers.size === 0) {
        // Check if this document should have chapters according to checkpoint
        const expectedChapters: number[] = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const task of checkpoint) {
          if (task.params.documentId === documentId && task.subtasks) {
            // eslint-disable-next-line no-restricted-syntax
            for (const subtask of task.subtasks) {
              expectedChapters.push(subtask.params.props.chapterNumber);
            }
          }
        }

        if (expectedChapters.length > 0) {
          // Folder should have files but is empty or has no matching files
          // eslint-disable-next-line no-restricted-syntax
          for (const chapterNum of expectedChapters) {
            const chapterPrefix = `${documentId}.${chapterNum.toString().padStart(3, '0')}`;
            missingFiles.push({
              documentId,
              chapterNumber: chapterNum,
              missingFiles: [`${chapterPrefix}.* (ALL FILES MISSING)`],
            });
          }
        }
        // eslint-disable-next-line no-continue
        continue;
      }

      // Check each chapter for missing files
      // eslint-disable-next-line no-restricted-syntax
      for (const chapterNum of Array.from(chapterNumbers).sort(
        (a, b) => a - b,
      )) {
        const chapterPrefix = `${documentId}.${chapterNum.toString().padStart(3, '0')}`;
        const missing: string[] = [];

        // Check if this chapter exists in checkpoint
        const chapterKey = `${documentId}:${chapterNum}`;
        if (!validChapters.has(chapterKey)) {
          missing.push(`[ORPHAN] ${chapterPrefix} - not in checkpoint`);
        }

        // Expected files for each chapter
        const expectedFiles = [
          `${chapterPrefix}.csv`,
          `${chapterPrefix}.json`,
          `${chapterPrefix}.xml`,
          `${chapterPrefix}_vie.csv`,
          `${chapterPrefix}_vie.json`,
          `${chapterPrefix}_vie.xml`,
          `${chapterPrefix}_vie.md`,
        ];

        // Check for each expected file
        // eslint-disable-next-line no-restricted-syntax
        for (const expectedFile of expectedFiles) {
          if (!files.includes(expectedFile)) {
            missing.push(expectedFile);
          }
        }

        if (missing.length > 0) {
          missingFiles.push({
            documentId,
            chapterNumber: chapterNum,
            missingFiles: missing,
          });
        }
      }
    } else {
      console.warn(
        `WARNING: Could not extract document ID from folder: ${folder}`,
      );
    }
  }

  return missingFiles;
};

const findEmptyVieCsvFiles = (): EmptyFile[] => {
  const emptyFiles: EmptyFile[] = [];

  if (!fs.existsSync(CORPUS_PATH)) {
    console.warn(`WARNING: Corpus path does not exist: ${CORPUS_PATH}`);
    return emptyFiles;
  }

  // Get all RBZ folders
  const folders = fs
    .readdirSync(CORPUS_PATH)
    .filter((name) => {
      const fullPath = path.join(CORPUS_PATH, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
    })
    .sort();

  // Check each folder for empty _vie.csv files
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const folderPath = path.join(CORPUS_PATH, folder);
    const documentId = folder.split(' ')[0];

    if (documentId) {
      const files = fs.readdirSync(folderPath);

      // Check all _vie.csv files
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        if (file.endsWith('_vie.csv')) {
          const filePath = path.join(folderPath, file);
          const stats = fs.statSync(filePath);

          // Check if file is 0 bytes or only has headers (no data rows)
          let isEmpty = false;

          if (stats.size === 0) {
            isEmpty = true;
          } else {
            // Read file and check if it has data rows
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.trim().split('\n');
            // File is empty if it has only 1 line (header) or no lines
            isEmpty = lines.length <= 1;
          }

          if (isEmpty) {
            // Extract chapter number from filename
            const match = file.match(/^RBZ_\d+\.(\d+)_vie\.csv$/);
            if (match?.[1]) {
              emptyFiles.push({
                documentId,
                chapterNumber: Number.parseInt(match[1], 10),
                file,
                size: stats.size,
              });
            }
          }
        }
      }
    }
  }

  return emptyFiles;
};

const updateCheckpoint = (
  missingFiles: MissingFile[],
): {
  updated: number;
  alreadyIncomplete: number;
  orphanedChapters: OrphanedChapter[];
  total: number;
} => {
  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.error(`ERROR: Checkpoint file not found: ${CHECKPOINT_PATH}`);
    return { updated: 0, alreadyIncomplete: 0, orphanedChapters: [], total: 0 };
  }

  // Load checkpoint
  const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
  const checkpoint: Checkpoint<CheckpointParams, SubtaskParams>[] =
    JSON.parse(raw);

  let updatedCount = 0;
  let alreadyIncompleteCount = 0;
  const orphanedChapters: OrphanedChapter[] = [];
  const totalTasks = checkpoint.length;

  // Create a map of documentId -> Set of chapter numbers that need re-crawling
  const needsRecrawl = new Map<string, Set<number>>();
  // eslint-disable-next-line no-restricted-syntax
  for (const item of missingFiles) {
    if (!needsRecrawl.has(item.documentId)) {
      needsRecrawl.set(item.documentId, new Set());
    }
    needsRecrawl.get(item.documentId)?.add(item.chapterNumber);
  }

  console.log(`\nFound ${needsRecrawl.size} documents needing updates`);

  // Create a map of documentId -> Map of chapterNumber -> subtask for quick lookup
  const checkpointMap = new Map<
    string,
    Map<number, Checkpoint<SubtaskParams>>
  >();
  // eslint-disable-next-line no-restricted-syntax
  for (const task of checkpoint) {
    const { documentId } = task.params;
    if (task.subtasks) {
      const chapterMap = new Map<number, Checkpoint<SubtaskParams>>();
      // eslint-disable-next-line no-restricted-syntax
      for (const subtask of task.subtasks) {
        chapterMap.set(subtask.params.props.chapterNumber, subtask);
      }
      checkpointMap.set(documentId, chapterMap);
    }
  }

  // Update checkpoint and track orphaned chapters
  // eslint-disable-next-line no-restricted-syntax
  for (const item of missingFiles) {
    const { documentId, chapterNumber } = item;
    const chapterMap = checkpointMap.get(documentId);

    if (!chapterMap) {
      orphanedChapters.push(item);
      // eslint-disable-next-line no-continue
      continue;
    }

    const subtask = chapterMap.get(chapterNumber);

    if (!subtask) {
      orphanedChapters.push(item);
    } else if (subtask.completed) {
      subtask.completed = false;
      updatedCount += 1;
    } else {
      alreadyIncompleteCount += 1;
    }
  }

  // Update parent task completion status
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

  return {
    updated: updatedCount,
    alreadyIncomplete: alreadyIncompleteCount,
    orphanedChapters,
    total: totalTasks,
  };
};

const main = (): void => {
  console.log('Scanning for duplicate folders...\n');

  const duplicates = findDuplicateFolders();

  if (duplicates.length > 0) {
    console.log(
      `Found ${duplicates.length} documentId(s) with duplicate folders:\n`,
    );

    // eslint-disable-next-line no-restricted-syntax
    for (const duplicate of duplicates) {
      console.log(`${duplicate.documentId}:`);
      console.log(`  Checkpoint title: "${duplicate.checkpointTitle}"`);

      if (duplicate.matchingFolder) {
        console.log(`  ✓ IN CHECKPOINT:  ${duplicate.matchingFolder}`);
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const folder of duplicate.nonMatchingFolders) {
        console.log(`  ✗ NOT IN CHECKPOINT: ${folder}`);
      }

      if (!duplicate.matchingFolder) {
        console.log(
          '  ⚠ WARNING: None of the folders match the checkpoint title!',
        );
      }

      console.log();
    }

    console.log(
      'ERROR: Duplicate documentIds found! Please resolve these duplicates before checking for missing files.',
    );
    console.log(
      'Each documentId should be unique. You need to manually review and correct the duplicate folders.\n',
    );
    return;
  }

  console.log('No duplicate folders found.\n');
  console.log('Counting file types...\n');

  const { existing } = countFileTypes();

  if (Object.keys(existing).length > 0) {
    console.log('Existing files by type:');
    const sortedExisting = Object.entries(existing).sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line no-restricted-syntax
    for (const [ext, count] of sortedExisting) {
      console.log(`  ${ext}: ${count}`);
    }
    console.log(
      `  Total: ${Object.values(existing).reduce((sum, count) => sum + count, 0)} files\n`,
    );
  } else {
    console.log('No files found in corpus.\n');
  }

  console.log('Scanning for missing files...\n');

  const missingFiles = findMissingFiles();

  console.log(`\nFound ${missingFiles.length} chapters with missing files:\n`);

  // Count missing file types
  const missingCounts = countMissingFileTypes(missingFiles);

  if (Object.keys(missingCounts).length > 0) {
    console.log('Missing files by type:');
    const sortedMissing = Object.entries(missingCounts).sort(
      (a, b) => b[1] - a[1],
    );
    // eslint-disable-next-line no-restricted-syntax
    for (const [ext, count] of sortedMissing) {
      console.log(`  ${ext}: ${count}`);
    }
    console.log(
      `  Total: ${Object.values(missingCounts).reduce((sum, count) => sum + count, 0)} missing files\n`,
    );
  }

  if (missingFiles.length > 0) {
    // Group by document
    const byDocument = new Map<string, MissingFile[]>();
    // eslint-disable-next-line no-restricted-syntax
    for (const item of missingFiles) {
      if (!byDocument.has(item.documentId)) {
        byDocument.set(item.documentId, []);
      }
      byDocument.get(item.documentId)?.push(item);
    }

    // Print grouped by document
    // eslint-disable-next-line no-restricted-syntax
    for (const [documentId, items] of byDocument) {
      console.log(`\n${documentId}:`);
      // eslint-disable-next-line no-restricted-syntax
      for (const item of items) {
        console.log(
          `  Chapter ${item.chapterNumber}: ${item.missingFiles.join(', ')}`,
        );
      }
    }
  }

  // Check for empty _vie.csv files
  console.log('\nChecking for empty _vie.csv files...\n');
  const emptyVieCsvFiles = findEmptyVieCsvFiles();

  if (emptyVieCsvFiles.length > 0) {
    console.log(`Found ${emptyVieCsvFiles.length} empty _vie.csv files:\n`);

    // Group empty files by document
    const emptyByDocument = new Map<string, EmptyFile[]>();
    // eslint-disable-next-line no-restricted-syntax
    for (const item of emptyVieCsvFiles) {
      if (!emptyByDocument.has(item.documentId)) {
        emptyByDocument.set(item.documentId, []);
      }
      emptyByDocument.get(item.documentId)?.push(item);
    }

    // Print grouped by document
    // eslint-disable-next-line no-restricted-syntax
    for (const [documentId, items] of emptyByDocument) {
      console.log(`${documentId}:`);
      // eslint-disable-next-line no-restricted-syntax
      for (const item of items) {
        console.log(`  Chapter ${item.chapterNumber}: ${item.file}`);
      }
    }
    console.log();
  } else {
    console.log('No empty _vie.csv files found.\n');
  }

  // Only update checkpoint if there are missing files
  if (missingFiles.length > 0) {
    console.log('\nUpdating checkpoint...');
    const { updated, alreadyIncomplete, orphanedChapters, total } =
      updateCheckpoint(missingFiles);

    if (updated > 0) {
      console.log(`\nMarked ${updated} subtasks as incomplete for re-crawling`);
    }
    if (alreadyIncomplete > 0) {
      console.log(
        `${alreadyIncomplete} subtasks were already marked as incomplete`,
      );
    }
    if (orphanedChapters.length > 0) {
      console.log(
        `\n${orphanedChapters.length} chapters not found in checkpoint (orphaned files or outside normal workflow):\n`,
      );

      // Group orphaned chapters by document
      const orphansByDocument = new Map<string, OrphanedChapter[]>();
      // eslint-disable-next-line no-restricted-syntax
      for (const orphan of orphanedChapters) {
        if (!orphansByDocument.has(orphan.documentId)) {
          orphansByDocument.set(orphan.documentId, []);
        }
        orphansByDocument.get(orphan.documentId)?.push(orphan);
      }

      // Print orphaned chapters grouped by document
      // eslint-disable-next-line no-restricted-syntax
      for (const [documentId, orphans] of orphansByDocument) {
        console.log(`  ${documentId}:`);
        // eslint-disable-next-line no-restricted-syntax
        for (const orphan of orphans) {
          console.log(
            `    Chapter ${orphan.chapterNumber}: ${orphan.missingFiles.join(', ')}`,
          );
        }
      }
    }

    console.log(`\nTotal tasks in checkpoint: ${total}`);

    if (updated > 0) {
      console.log('Re-run the crawler to fetch missing files');
    } else if (orphanedChapters.length > 0 && alreadyIncomplete === 0) {
      console.log(
        'The missing files are not in the checkpoint - they may be orphaned files or test data',
      );
    } else {
      console.log('Checkpoint is up to date');
    }
  } else {
    console.log('\nNo missing files to update in checkpoint.');
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
