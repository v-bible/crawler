import path from 'path';

export const DEFAULT_METADATA_FILE_PATH = path.join(
  __dirname,
  '../data',
  'main.tsv',
);

export const DEFAULT_OUTPUT_FILE_DIR = path.join(__dirname, '../dist/corpus');

export const DEFAULT_CRAWL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
