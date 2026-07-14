import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as lockfile from 'proper-lockfile';
import { type Logger } from 'winston';
import { DEFAULT_CHECKPOINT_FILE_PATH } from '@/constants';
import {
  readCheckpointFile,
  writeCheckpointFile,
} from '@/lib/crawler/checkpointFileUtils';
import { logger } from '@/logger/logger';

export type Checkpoint<
  TTask extends Record<string, unknown>,
  TSubtask extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  completed: boolean;
  params: TTask;
  subtasks: Checkpoint<TSubtask, never>[] | null;
  skipHandler?: string[]; // Optional array of handler names to skip for this checkpoint
};

export type WithCheckpointOptions<TTask extends Record<string, unknown>> = {
  // NOTE: If true, will return all checkpoints regardless of completion
  // status
  forceAll?: boolean;
  // NOTE: If provided, will return only checkpoints with these ids
  forceCheckpointId?: Checkpoint<TTask>['id'][];
  // NOTE: If true, will force all subtasks to be returned regardless of completion status
  forceAllSubtasks?: boolean;
};

export type WithCheckpointParams<
  TTask extends Record<string, unknown>,
  TSubtask extends Record<string, unknown>,
> = {
  getInitialData: () => Promise<TTask[]>;
  getSubtaskData?: (parent: Checkpoint<TTask, TSubtask>) => Promise<TSubtask[]>;
  getCheckpointId: (item: TTask) => string;
  filterCheckpoint: (data: Checkpoint<TTask, TSubtask>) => boolean;
  sortCheckpoint?: (
    a: Checkpoint<TTask, TSubtask>,
    b: Checkpoint<TTask, TSubtask>,
  ) => number;
  getSubtaskId?: (
    parent: Checkpoint<TTask, TSubtask>,
    subtask: TSubtask,
  ) => string;
  filterSubtasks?: (data: Checkpoint<TSubtask, never>) => boolean;
  sortSubtasks?: (
    a: Checkpoint<TSubtask, never>,
    b: Checkpoint<TSubtask, never>,
  ) => number;
  skipCheckpointCheck?: boolean;
  skipSubtaskCheckpointCheck?: boolean;
  checkpointFilePath?: string;
  options?: WithCheckpointOptions<TTask>;
  log?: Logger;
};

export type WithCheckpointReturn<
  TTask extends Record<string, unknown>,
  TSubtask extends Record<string, unknown>,
> = {
  filteredCheckpoint: Checkpoint<TTask, TSubtask>[];
  getAllCheckpoint: () => Checkpoint<TTask, TSubtask>[];
  setCheckpointComplete: (
    checkpointId: Checkpoint<TTask, TSubtask>['id'],
    completed: Checkpoint<TTask, TSubtask>['completed'],
  ) => void;
  setSubtaskComplete: (
    parentId: Checkpoint<TTask, TSubtask>['id'],
    subtaskId: Checkpoint<TTask, TSubtask>['id'],
    completed: Checkpoint<TTask, TSubtask>['completed'],
  ) => void;
};

const withCheckpoint = async <
  TTask extends Record<string, unknown>,
  TSubtask extends Record<string, unknown>,
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
  checkpointFilePath: filePath = DEFAULT_CHECKPOINT_FILE_PATH,
  options,
  log,
}: WithCheckpointParams<TTask, TSubtask>): Promise<
  WithCheckpointReturn<TTask, TSubtask>
> => {
  const {
    forceAll = false,
    forceCheckpointId = [],
    forceAllSubtasks = false,
  } = options || {};

  log = log || logger;

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

  const savedCheckpoint = await readCheckpointFile<TTask, TSubtask>(filePath);

  if (!skipCheckpointCheck || savedCheckpoint?.length === 0) {
    // eslint-disable-next-line no-restricted-syntax
    for await (const item of await getInitialData()) {
      const checkpoint: Checkpoint<TTask, TSubtask> = {
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
    const newCheckpoints: Checkpoint<TTask, TSubtask>[] = [];

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
          subtasks: null,
        } satisfies Checkpoint<TSubtask>;
      });

      checkpoint.subtasks = subtasks;

      newCheckpoints.push(checkpoint);
    }

    // Re-read the entire checkpoint file with lock, update it, and write back
    const allCheckpoints = await readCheckpointFile<TTask, TSubtask>(filePath);

    // Update only the checkpoints that we processed
    newCheckpoints.forEach((newCheckpoint) => {
      const idx = allCheckpoints.findIndex((c) => c.id === newCheckpoint.id);
      if (idx !== -1) {
        allCheckpoints[idx] = newCheckpoint;
      }
    });

    await writeCheckpointFile(filePath, allCheckpoints);
  }

  let filteredCheckpoint: Checkpoint<TTask, TSubtask>[] = [];

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
    let filteredSubtasks: Checkpoint<TSubtask>[] = [];

    if (!checkpoint.subtasks || checkpoint.subtasks === null) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (forceAllSubtasks) {
      filteredSubtasks = checkpoint.subtasks;
    } else if (filterSubtasks) {
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
          ) as Checkpoint<TTask, TSubtask>[];

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
            log.error(
              `Checkpoint with id ${checkpointId} not found in saved checkpoints.`,
            );
          }
        } finally {
          lockfile.unlockSync(filePath);
        }
      } catch (error) {
        log.error('Error in setCheckpointComplete:', error);
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
          ) as Checkpoint<TTask, TSubtask>[];

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

              // Check if all subtasks are completed, then mark parent as completed
              const allSubtasksCompleted = currentCheckpoint[
                parentIdx
              ]!.subtasks!.every((subtask) => subtask.completed);

              if (allSubtasksCompleted) {
                currentCheckpoint[parentIdx]!.completed = true;
              }

              writeFileSync(
                filePath,
                JSON.stringify(currentCheckpoint, null, 2),
                'utf-8',
              );
            } else {
              log.error(
                `Subtask with id ${subtaskId} not found in parent checkpoint ${parentId}.`,
              );
            }
          } else {
            log.error(
              `Parent checkpoint with id ${parentId} not found in saved checkpoints.`,
            );
          }
        } finally {
          lockfile.unlockSync(filePath);
        }
      } catch (error) {
        log.error('Error in setSubtaskComplete:', error);
      }
    },
  };
};

export { withCheckpoint };
