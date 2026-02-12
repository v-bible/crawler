import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as lockfile from 'proper-lockfile';
import { DEFAULT_CHECKPOINT_FILE_PATH } from '@/constants';
import {
  readCheckpointFile,
  writeCheckpointFile,
} from '@/lib/crawler/checkpointFileUtils';
import { logger } from '@/logger/logger';

export type Checkpoint<
  T extends Record<string, unknown>,
  K extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  completed: boolean;
  params: T;
  subtasks?: Checkpoint<K, never>[] | null;
};

export type WithCheckpointOptions<T extends Record<string, unknown>> = {
  // NOTE: If true, will return all checkpoints regardless of completion
  // status
  forceAll?: boolean;
  // NOTE: If provided, will return only checkpoints with these ids
  forceCheckpointId?: Checkpoint<T>['id'][];
};

export type WithCheckpointParams<
  T extends Record<string, unknown>,
  K extends Record<string, unknown>,
> = {
  getInitialData: () => Promise<T[]>;
  getSubtaskData?: (parent: Checkpoint<T, K>) => Promise<K[]>;
  getCheckpointId: (item: T) => string;
  filterCheckpoint: (data: Checkpoint<T, K>) => boolean;
  sortCheckpoint?: (a: Checkpoint<T, K>, b: Checkpoint<T, K>) => number;
  getSubtaskId?: (parent: Checkpoint<T, K>, subtask: K) => string;
  filterSubtasks?: (data: Checkpoint<K, never>) => boolean;
  sortSubtasks?: (a: Checkpoint<K, never>, b: Checkpoint<K, never>) => number;
  skipCheckpointCheck?: boolean;
  skipSubtaskCheckpointCheck?: boolean;
  filePath?: string;
  options?: WithCheckpointOptions<T>;
};

export type WithCheckpointReturn<
  T extends Record<string, unknown>,
  K extends Record<string, unknown>,
> = {
  filteredCheckpoint: Checkpoint<T, K>[];
  getAllCheckpoint: () => Checkpoint<T, K>[];
  setCheckpointComplete: (
    checkpointId: Checkpoint<T, K>['id'],
    completed: Checkpoint<T, K>['completed'],
  ) => void;
  setSubtaskComplete: (
    parentId: Checkpoint<T, K>['id'],
    subtaskId: Checkpoint<T, K>['id'],
    completed: Checkpoint<T, K>['completed'],
  ) => void;
};

const withCheckpoint = async <
  T extends Record<string, unknown>,
  K extends Record<string, unknown>,
>({
  getInitialData,
  // NOTE: Function to set the checkpoint id based on the data
  getCheckpointId,
  filterCheckpoint,
  sortCheckpoint,
  getSubtaskData,
  getSubtaskId,
  filterSubtasks,
  sortSubtasks,
  skipCheckpointCheck = false,
  skipSubtaskCheckpointCheck = false,
  filePath = DEFAULT_CHECKPOINT_FILE_PATH,
  options,
}: WithCheckpointParams<T, K>): Promise<WithCheckpointReturn<T, K>> => {
  const { forceAll = false, forceCheckpointId = [] } = options || {};

  // NOTE: Open file to try to read, if not exists, create it with empty array
  try {
    const pathDir = path.dirname(filePath);

    // Ensure the directory exists
    if (!existsSync(pathDir)) {
      mkdirSync(pathDir, { recursive: true });
    }

    readFileSync(filePath, 'utf-8');
  } catch (error) {
    writeFileSync(filePath, '[]', 'utf-8');
  }

  const savedCheckpoint = await readCheckpointFile<T, K>(filePath);

  if (!skipCheckpointCheck || savedCheckpoint?.length === 0) {
    // eslint-disable-next-line no-restricted-syntax
    for await (const item of await getInitialData()) {
      const checkpoint: Checkpoint<T, K> = {
        id: getCheckpointId(item),
        params: item,
        completed: false,
        subtasks: null,
      };

      savedCheckpoint.push(checkpoint);
    }

    await writeCheckpointFile(filePath, savedCheckpoint);
  }

  if (getSubtaskData && getSubtaskId) {
    const newCheckpoints: Checkpoint<T, K>[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const checkpoint of savedCheckpoint) {
      // NOTE: Skip get subtask data if already exists
      if (skipSubtaskCheckpointCheck && checkpoint.subtasks !== null) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Initialize subtasks if they don't exist
      const subtaskItems = await getSubtaskData(checkpoint);

      const subtasks = subtaskItems.map((subtaskItem) => {
        return {
          id: getSubtaskId(checkpoint, subtaskItem),
          params: subtaskItem,
          completed: false,
        } satisfies Checkpoint<K>;
      });

      checkpoint.subtasks = subtasks;

      newCheckpoints.push(checkpoint);
    }

    // Re-read the entire checkpoint file with lock, update it, and write back
    const allCheckpoints = await readCheckpointFile<T, K>(filePath);

    // Update only the checkpoints that we processed
    newCheckpoints.forEach((newCheckpoint) => {
      const idx = allCheckpoints.findIndex((c) => c.id === newCheckpoint.id);
      if (idx !== -1) {
        allCheckpoints[idx] = newCheckpoint;
      }
    });

    await writeCheckpointFile(filePath, allCheckpoints);
  }

  let filteredCheckpoint: Checkpoint<T, K>[] = [];

  if (forceAll) {
    filteredCheckpoint = savedCheckpoint;
  } else if (forceCheckpointId.length > 0) {
    filteredCheckpoint = savedCheckpoint.filter((checkpoint) => {
      return forceCheckpointId.includes(checkpoint.id);
    });
  } else if (filterCheckpoint) {
    filteredCheckpoint = savedCheckpoint.filter(filterCheckpoint);
  } else {
    filteredCheckpoint = savedCheckpoint.filter((checkpoint) => {
      return !checkpoint.completed;
    });
  }

  if (sortCheckpoint) {
    filteredCheckpoint.sort(sortCheckpoint);
  }

  // eslint-disable-next-line no-restricted-syntax
  for await (const checkpoint of filteredCheckpoint) {
    let filteredSubtasks: Checkpoint<K>[] = [];

    if (!checkpoint.subtasks || checkpoint.subtasks === null) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (filterSubtasks) {
      // If filterSubtasks is provided, filter the subtasks accordingly
      filteredSubtasks = checkpoint.subtasks.filter(filterSubtasks);
    }

    if (sortSubtasks) {
      filteredSubtasks.sort(sortSubtasks);
    }

    checkpoint.subtasks = filteredSubtasks;
  }

  return {
    filteredCheckpoint,
    getAllCheckpoint: () => {
      return savedCheckpoint;
    },
    setCheckpointComplete: (checkpointId, completed) => {
      // Atomic read-modify-write operation with lock held for entire duration
      try {
        lockfile.lockSync(filePath, { stale: 10000 });

        try {
          const checkpointFileData = readFileSync(filePath, 'utf-8');
          const currentCheckpoint = JSON.parse(
            checkpointFileData || '[]',
          ) as Checkpoint<T, K>[];

          const idx = currentCheckpoint.findIndex(
            (checkpoint) => checkpointId === checkpoint.id,
          );

          if (idx !== -1) {
            currentCheckpoint[idx]!.completed = completed;

            writeFileSync(
              filePath,
              JSON.stringify(currentCheckpoint, null, 2),
              'utf-8',
            );
          } else {
            logger.error(
              `Checkpoint with id ${checkpointId} not found in saved checkpoints.`,
            );
          }
        } finally {
          lockfile.unlockSync(filePath);
        }
      } catch (error) {
        logger.error('Error in setCheckpointComplete:', error);
      }
    },
    setSubtaskComplete: (parentId, subtaskId, completed) => {
      // Atomic read-modify-write operation with lock held for entire duration
      try {
        lockfile.lockSync(filePath, { stale: 10000 });

        try {
          const checkpointFileData = readFileSync(filePath, 'utf-8');
          const currentCheckpoint = JSON.parse(
            checkpointFileData || '[]',
          ) as Checkpoint<T, K>[];

          const parentIdx = currentCheckpoint.findIndex(
            (checkpoint) => parentId === checkpoint.id,
          );

          if (parentIdx !== -1) {
            const subtaskIdx = currentCheckpoint[
              parentIdx
            ]!.subtasks?.findIndex((subtask) => subtaskId === subtask.id);

            if (
              subtaskIdx !== undefined &&
              subtaskIdx !== -1 &&
              currentCheckpoint[parentIdx]!.subtasks
            ) {
              currentCheckpoint[parentIdx]!.subtasks![subtaskIdx]!.completed =
                completed;

              writeFileSync(
                filePath,
                JSON.stringify(currentCheckpoint, null, 2),
                'utf-8',
              );
            } else {
              logger.error(
                `Subtask with id ${subtaskId} not found in parent checkpoint ${parentId}.`,
              );
            }
          } else {
            logger.error(
              `Parent checkpoint with id ${parentId} not found in saved checkpoints.`,
            );
          }
        } finally {
          lockfile.unlockSync(filePath);
        }
      } catch (error) {
        logger.error('Error in setSubtaskComplete:', error);
      }
    },
  };
};

export { withCheckpoint };
