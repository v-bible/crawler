import path from 'path';

// Project root directory (one level up from src/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Input data paths
export const DEFAULT_METADATA_FILE_PATH = path.join(
  PROJECT_ROOT,
  'data',
  'main.tsv',
);

// Output directories
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'dist');
export const DEFAULT_OUTPUT_FILE_DIR = path.join(DEFAULT_OUTPUT_DIR, 'corpus');
export const DEFAULT_TASK_DIR = path.join(DEFAULT_OUTPUT_DIR, 'task-data');

// Timeouts
export const DEFAULT_CRAWL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
