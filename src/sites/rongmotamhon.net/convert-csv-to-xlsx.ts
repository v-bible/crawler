#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Convert CSV files in corpus/Z to XLSX format.
 *
 * Usage:
 *   pnpm exec tsx src/sites/rongmotamhon.net/convert-csv-to-xlsx.ts
 *   pnpm exec tsx src/sites/rongmotamhon.net/convert-csv-to-xlsx.ts --dry-run
 *   pnpm exec tsx src/sites/rongmotamhon.net/convert-csv-to-xlsx.ts --overwrite
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'fast-csv';
import * as XLSX from 'xlsx';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';

const XLSX_API = (XLSX as unknown as { default?: typeof XLSX }).default ?? XLSX;

const CORPUS_Z_PATH = path.join(DEFAULT_OUTPUT_FILE_DIR, 'Z');

type ConvertOptions = {
  dryRun: boolean;
  overwrite: boolean;
};

type ConvertSummary = {
  discovered: number;
  converted: number;
  skipped: number;
  failed: number;
};

const getOptions = (): ConvertOptions => {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    overwrite: args.has('--overwrite'),
  };
};

const findCsvFiles = (rootDir: string): string[] => {
  const csvFiles: string[] = [];

  const walk = (currentDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        csvFiles.push(fullPath);
      }
    }
  };

  walk(rootDir);
  return csvFiles;
};

const convertCsvToXlsx = (
  csvPath: string,
  options: ConvertOptions,
): Promise<'converted' | 'skipped'> => {
  return new Promise((resolve, reject) => {
    const xlsxPath = csvPath.replace(/\.csv$/i, '.xlsx');

    if (!options.overwrite && fs.existsSync(xlsxPath)) {
      resolve('skipped');
      return;
    }

    if (options.dryRun) {
      resolve('converted');
      return;
    }

    const rows: unknown[][] = [];

    const stream = fs.createReadStream(csvPath, { encoding: 'utf-8' });

    stream
      .pipe(parse({ headers: false }))
      .on('data', (row) => {
        rows.push(Object.values(row) as unknown[]);
      })
      .on('end', () => {
        try {
          // Truncate cells exceeding Excel's 32,767 character limit
          const truncatedRows = rows.map((row) =>
            row.map((cell) => {
              if (typeof cell === 'string' && cell.length > 32767) {
                return `${cell.substring(0, 32760)}...`;
              }
              return cell;
            }),
          );

          const worksheet = XLSX_API.utils.aoa_to_sheet(truncatedRows);
          const workbook = XLSX_API.utils.book_new();
          XLSX_API.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
          XLSX_API.writeFile(workbook, xlsxPath, { compression: true });
          resolve('converted');
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

const main = async (): Promise<void> => {
  const options = getOptions();

  if (!fs.existsSync(CORPUS_Z_PATH)) {
    console.error(`ERROR: corpus path not found: ${CORPUS_Z_PATH}`);
    process.exit(1);
  }

  console.log(`Scanning CSV files in: ${CORPUS_Z_PATH}`);
  const csvFiles = findCsvFiles(CORPUS_Z_PATH);
  console.log(`Found ${csvFiles.length} CSV files`);

  if (options.dryRun) {
    console.log('Running in dry-run mode. No files will be written.');
  }

  const summary: ConvertSummary = {
    discovered: csvFiles.length,
    converted: 0,
    skipped: 0,
    failed: 0,
  };

  const failedFiles: string[] = [];

  // Process files in batches to avoid too many concurrent operations
  const batchSize = 10;
  for (let i = 0; i < csvFiles.length; i += batchSize) {
    const batch = csvFiles.slice(i, i + batchSize);
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    await Promise.all(
      batch.map(async (csvPath, batchIndex) => {
        try {
          const result = await convertCsvToXlsx(csvPath, options);
          if (result === 'converted') {
            summary.converted += 1;
          } else {
            summary.skipped += 1;
          }
        } catch (error) {
          summary.failed += 1;
          const relPath = path.relative(CORPUS_Z_PATH, csvPath);
          failedFiles.push(relPath);
          const fileIndex = i + batchIndex + 1;
          console.error(`Failed [${fileIndex}/${csvFiles.length}]: ${relPath}`);
        }
      }),
    );

    // Print progress every 100 files
    if ((i + batchSize) % 100 === 0 || i + batchSize >= csvFiles.length) {
      console.log(
        `Progress: ${Math.min(i + batchSize, csvFiles.length)}/${csvFiles.length} (Converted: ${summary.converted}, Failed: ${summary.failed})`,
      );
    }
  }

  console.log('\nSummary');
  console.log(`  Discovered: ${summary.discovered}`);
  console.log(`  Converted:  ${summary.converted}`);
  console.log(`  Skipped:    ${summary.skipped}`);
  console.log(`  Failed:     ${summary.failed}`);

  if (summary.failed > 0) {
    console.log('\nFailed files (for manual processing):');
    failedFiles.forEach((file) => console.log(`  - ${file}`));

    // Write failed files list to a log file
    const failedFilesPath = path.join(
      CORPUS_Z_PATH,
      '..',
      'failed-conversions.txt',
    );
    fs.writeFileSync(failedFilesPath, `${failedFiles.join('\n')}\n`);
    console.log(`\nFailed files list saved to: ${failedFilesPath}`);
  }

  if (!options.dryRun && summary.failed === 0) {
    console.log('\nDone. All CSV files were converted to XLSX.');
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { findCsvFiles, convertCsvToXlsx };
