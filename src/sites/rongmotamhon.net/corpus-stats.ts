#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Corpus Statistics Script
 *
 * Analyzes the rongmotamhon.net corpus and reports:
 * - Total files by type
 * - Sentence counts (from CSV files)
 * - Chinese and Chinese-Vietnamese (both in parallel corpus files)
 * - Vietnamese translations (separate files)
 * - PDF files (can-long, vinh-lac, CBETA)
 * - Empty CSV files (main metrics - .csv and _vie.csv only)
 *
 * Note: The .csv files contain BOTH Chinese and Chinese-Vietnamese in the same file
 *
 * Usage:
 *   pnpm exec tsx src/sites/rongmotamhon.net/corpus-stats.ts
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';

const CORPUS_PATH = path.join(DEFAULT_OUTPUT_FILE_DIR, 'Z');

type FileStats = {
  // File counts by type
  csvParallel: number; // .csv files (contain both Chinese and Chinese-Vietnamese)
  csvVietnamese: number; // _vie.csv files (Vietnamese translation)
  jsonParallel: number; // .json files (contain both Chinese and Chinese-Vietnamese)
  jsonVietnamese: number; // _vie.json files (Vietnamese translation)
  xmlParallel: number; // .xml files (contain both Chinese and Chinese-Vietnamese)
  xmlVietnamese: number; // _vie.xml files (Vietnamese translation)
  mdVietnamese: number; // _vie.md files (Vietnamese markdown)
  pdfCanLong: number;
  pdfVinhLac: number;
  pdfCBETA: number;

  // Sentence counts (from CSV files)
  // Note: .csv files contain BOTH Chinese and Chinese-Vietnamese in the same file
  sentencesChinese: number; // From .csv files (Chinese column)
  sentencesChineseVietnamese: number; // From .csv files (Chinese-Vietnamese column)
  sentencesVietnamese: number; // From _vie.csv files (Vietnamese translation)

  // Folder statistics
  totalFolders: number;
  totalFiles: number;

  // Empty CSV files only (main metrics)
  emptyCsvParallel: string[]; // Empty .csv files (Chinese/Chinese-Vietnamese)
  emptyCsvVietnamese: string[]; // Empty _vie.csv files (Vietnamese)
};

/**
 * Classify file type and return category
 */
const classifyFile = (
  filename: string,
): {
  category:
    | 'csv-parallel'
    | 'csv-vietnamese'
    | 'json-parallel'
    | 'json-vietnamese'
    | 'xml-parallel'
    | 'xml-vietnamese'
    | 'md-vietnamese'
    | 'pdf-can-long'
    | 'pdf-vinh-lac'
    | 'pdf-cbeta'
    | 'unknown';
  needsRowCount: boolean;
} => {
  // PDF files
  if (filename.endsWith('_can-long.pdf')) {
    return { category: 'pdf-can-long', needsRowCount: false };
  }
  if (filename.endsWith('_vinh-lac.pdf')) {
    return { category: 'pdf-vinh-lac', needsRowCount: false };
  }
  if (filename.toLowerCase().endsWith('_cbeta.pdf')) {
    return { category: 'pdf-cbeta', needsRowCount: false };
  }

  // Vietnamese translation files
  if (filename.endsWith('_vie.csv')) {
    return { category: 'csv-vietnamese', needsRowCount: true };
  }
  if (filename.endsWith('_vie.json')) {
    return { category: 'json-vietnamese', needsRowCount: false };
  }
  if (filename.endsWith('_vie.xml')) {
    return { category: 'xml-vietnamese', needsRowCount: false };
  }
  if (filename.endsWith('_vie.md')) {
    return { category: 'md-vietnamese', needsRowCount: false };
  }

  // Parallel corpus files (contain BOTH Chinese and Chinese-Vietnamese)
  if (filename.endsWith('.csv')) {
    return { category: 'csv-parallel', needsRowCount: true };
  }
  if (filename.endsWith('.json')) {
    return { category: 'json-parallel', needsRowCount: false };
  }
  if (filename.endsWith('.xml')) {
    return { category: 'xml-parallel', needsRowCount: false };
  }

  return { category: 'unknown', needsRowCount: false };
};

/**
 * Count rows in a CSV file (excluding header)
 */
const countCsvRows = (filePath: string): number => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    // Subtract 1 for header row
    return Math.max(0, lines.length - 1);
  } catch (error) {
    console.warn(`Warning: Failed to read CSV file: ${filePath}`);
    return 0;
  }
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
 * Scan corpus and collect statistics
 */
const collectStats = (): FileStats => {
  const stats: FileStats = {
    csvParallel: 0,
    csvVietnamese: 0,
    jsonParallel: 0,
    jsonVietnamese: 0,
    xmlParallel: 0,
    xmlVietnamese: 0,
    mdVietnamese: 0,
    pdfCanLong: 0,
    pdfVinhLac: 0,
    pdfCBETA: 0,
    sentencesChinese: 0,
    sentencesChineseVietnamese: 0,
    sentencesVietnamese: 0,
    totalFolders: 0,
    totalFiles: 0,
    emptyCsvParallel: [],
    emptyCsvVietnamese: [],
  };

  if (!fs.existsSync(CORPUS_PATH)) {
    console.warn(`WARNING: Corpus path does not exist: ${CORPUS_PATH}`);
    return stats;
  }

  // Get all RBZ folders
  const folders = fs
    .readdirSync(CORPUS_PATH)
    .filter((name) => {
      const fullPath = path.join(CORPUS_PATH, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('RBZ_');
    })
    .sort();

  stats.totalFolders = folders.length;

  console.log(`Scanning ${folders.length} folders...\n`);

  // Process each folder
  // eslint-disable-next-line no-restricted-syntax
  for (const folder of folders) {
    const folderPath = path.join(CORPUS_PATH, folder);
    const files = fs.readdirSync(folderPath);

    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const filePath = path.join(folderPath, file);

      stats.totalFiles += 1;

      const { category, needsRowCount } = classifyFile(file);

      // Update file counts
      switch (category) {
        case 'csv-parallel':
          stats.csvParallel += 1;
          if (needsRowCount) {
            // Check if CSV is empty
            if (isCsvEmpty(filePath)) {
              stats.emptyCsvParallel.push(path.relative(CORPUS_PATH, filePath));
            } else {
              const rowCount = countCsvRows(filePath);
              // Parallel corpus: same CSV contains BOTH Chinese and Chinese-Vietnamese
              stats.sentencesChinese += rowCount;
              stats.sentencesChineseVietnamese += rowCount;
            }
          }
          break;
        case 'csv-vietnamese':
          stats.csvVietnamese += 1;
          if (needsRowCount) {
            // Check if CSV is empty
            if (isCsvEmpty(filePath)) {
              stats.emptyCsvVietnamese.push(
                path.relative(CORPUS_PATH, filePath),
              );
            } else {
              stats.sentencesVietnamese += countCsvRows(filePath);
            }
          }
          break;
        case 'json-parallel':
          stats.jsonParallel += 1;
          break;
        case 'json-vietnamese':
          stats.jsonVietnamese += 1;
          break;
        case 'xml-parallel':
          stats.xmlParallel += 1;
          break;
        case 'xml-vietnamese':
          stats.xmlVietnamese += 1;
          break;
        case 'md-vietnamese':
          stats.mdVietnamese += 1;
          break;
        case 'pdf-can-long':
          stats.pdfCanLong += 1;
          break;
        case 'pdf-vinh-lac':
          stats.pdfVinhLac += 1;
          break;
        case 'pdf-cbeta':
          stats.pdfCBETA += 1;
          break;
        default:
          // Unknown file type - skip
          break;
      }
    }
  }

  return stats;
};

/**
 * Format number with thousand separators
 */
const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

/**
 * Print statistics report
 */
const printReport = (stats: FileStats): void => {
  console.log('═'.repeat(80));
  console.log('CORPUS STATISTICS - rongmotamhon.net');
  console.log('═'.repeat(80));
  console.log();

  // Overview
  console.log('OVERVIEW');
  console.log('─'.repeat(80));
  console.log(`  Total Folders:    ${formatNumber(stats.totalFolders)}`);
  console.log(`  Total Files:      ${formatNumber(stats.totalFiles)}`);
  console.log();

  // File Counts by Type
  console.log('FILE COUNTS BY TYPE');
  console.log('─'.repeat(80));
  console.log();
  console.log('  Parallel Corpus Files (Chinese + Chinese-Vietnamese):');
  console.log(
    `    CSV:            ${formatNumber(stats.csvParallel).padStart(10)}`,
  );
  console.log(
    `    JSON:           ${formatNumber(stats.jsonParallel).padStart(10)}`,
  );
  console.log(
    `    XML:            ${formatNumber(stats.xmlParallel).padStart(10)}`,
  );
  console.log();
  console.log('  Vietnamese Translation Files:');
  console.log(
    `    CSV:            ${formatNumber(stats.csvVietnamese).padStart(10)}`,
  );
  console.log(
    `    JSON:           ${formatNumber(stats.jsonVietnamese).padStart(10)}`,
  );
  console.log(
    `    XML:            ${formatNumber(stats.xmlVietnamese).padStart(10)}`,
  );
  console.log(
    `    Markdown:       ${formatNumber(stats.mdVietnamese).padStart(10)}`,
  );
  console.log();
  console.log('  PDF Files:');
  console.log(
    `    Can Long:       ${formatNumber(stats.pdfCanLong).padStart(10)}`,
  );
  console.log(
    `    Vinh Lac:       ${formatNumber(stats.pdfVinhLac).padStart(10)}`,
  );
  console.log(
    `    CBETA:          ${formatNumber(stats.pdfCBETA).padStart(10)}`,
  );
  console.log();

  // Sentence Counts
  console.log('SENTENCE COUNTS (from CSV files)');
  console.log('─'.repeat(80));
  console.log(
    `  Chinese:          ${formatNumber(stats.sentencesChinese).padStart(10)} sentences`,
  );
  console.log(
    `  Chinese-Viet:     ${formatNumber(stats.sentencesChineseVietnamese).padStart(10)} sentences`,
  );
  console.log(
    `  Vietnamese:       ${formatNumber(stats.sentencesVietnamese).padStart(10)} sentences`,
  );
  console.log(
    `  Total:            ${formatNumber(stats.sentencesChinese + stats.sentencesChineseVietnamese + stats.sentencesVietnamese).padStart(10)} sentences`,
  );
  console.log();
  console.log(
    '  Note: Parallel CSV files contain BOTH Chinese and Chinese-Vietnamese',
  );
  console.log();

  // Empty CSV Files Warning
  const totalEmptyCsv =
    stats.emptyCsvParallel.length + stats.emptyCsvVietnamese.length;

  if (totalEmptyCsv > 0) {
    console.log('WARNING: EMPTY CSV FILES DETECTED');
    console.log('─'.repeat(80));
    console.log(`  Found ${totalEmptyCsv} empty CSV files\n`);

    // Show empty Chinese/Chinese-Vietnamese CSV files
    if (stats.emptyCsvParallel.length > 0) {
      console.log(
        `  Empty Chinese/Chinese-Vietnamese CSV (.csv): ${stats.emptyCsvParallel.length}`,
      );
      const showCount = Math.min(10, stats.emptyCsvParallel.length);
      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < showCount; i += 1) {
        console.log(`    - ${stats.emptyCsvParallel[i]}`);
      }
      if (stats.emptyCsvParallel.length > 10) {
        console.log(`    ... and ${stats.emptyCsvParallel.length - 10} more`);
      }
      console.log();
    }

    // Show empty Vietnamese CSV files
    if (stats.emptyCsvVietnamese.length > 0) {
      console.log(
        `  Empty Vietnamese CSV (_vie.csv): ${stats.emptyCsvVietnamese.length}`,
      );
      const showCount = Math.min(10, stats.emptyCsvVietnamese.length);
      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < showCount; i += 1) {
        console.log(`    - ${stats.emptyCsvVietnamese[i]}`);
      }
      if (stats.emptyCsvVietnamese.length > 10) {
        console.log(`    ... and ${stats.emptyCsvVietnamese.length - 10} more`);
      }
      console.log();
    }
  } else {
    console.log('NO EMPTY CSV FILES DETECTED');
    console.log('─'.repeat(80));
    console.log('  All CSV files contain data');
    console.log();
  }

  console.log('═'.repeat(80));
};

/**
 * Main function
 */
const main = (): void => {
  console.log('Collecting corpus statistics...\n');

  const stats = collectStats();

  printReport(stats);
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { collectStats, printReport, classifyFile, countCsvRows, isCsvEmpty };
