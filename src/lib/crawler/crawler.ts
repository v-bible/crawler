import { randomUUID } from 'crypto';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { Logger } from 'winston';
import { ZodError, z } from 'zod';
import {
  DEFAULT_CHECKPOINT_DIR,
  DEFAULT_CRAWL_COUNT,
  DEFAULT_OUTPUT_FILE_DIR,
  DEFAULT_SUB_TASK_CONCURRENCY_LIMIT,
} from '@/constants';
import {
  type Checkpoint,
  type WithCheckpointOptions,
  withCheckpoint,
} from '@/lib/crawler/checkpoint';
import { readCheckpointFile } from '@/lib/crawler/checkpointFileUtils';
import { type GetDefaultDocumentPathFunction } from '@/lib/crawler/fileUtils';
import { defaultFilterCheckpoint } from '@/lib/crawler/filterUtils';
import {
  type ChapterParams,
  type DocumentParams,
  type GenreParams,
  type Metadata,
  type MetadataOutput,
  MetadataSchema,
} from '@/lib/crawler/schema';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { type ChapterTreeOutput } from '@/lib/crawler/treeSchema';
import {
  type GetFileNameFunction,
  Worker,
  type WorkerHandler,
} from '@/lib/crawler/worker';
import { logger } from '@/logger/logger';

export type CrawlerWorkerHandler<TData, TOutput, TMeta> = WorkerHandler<
  TData,
  TOutput,
  TMeta
> & {
  handler: WorkerHandler<TData, TOutput, TMeta>['handler'] & {
    output?: {
      extension: string;
      getFileName: GetFileNameFunction<
        ChapterParams & {
          extension: string;
          documentTitle?: string;
          suffix?: string;
        }
      >;
    };
  };
};

export type CrawHref<T = Record<string, string>> = {
  href: string;
  props?: T;
};

export type GetChaptersFunctionHref = CrawHref<{
  chapterNumber: number;
  chapterName?: string;
  mdHref?: string;
}>;

export type GetMetadataListFunction = () => Promise<Metadata[]>;
export type FilterMetadataFunction = (metadata: MetadataOutput) => boolean;

export type FilterCheckpointFunction = (
  checkpoint: Checkpoint<Metadata>,
) => boolean;
export type SortCheckpointFunction = (
  a: Checkpoint<Metadata>,
  b: Checkpoint<Metadata>,
) => number;
export type FilterSubtasksFunction = (
  checkpoint: Checkpoint<GetChaptersFunctionHref, never>,
) => boolean;
export type SortSubtasksFunction = (
  a: Checkpoint<GetChaptersFunctionHref, never>,
  b: Checkpoint<GetChaptersFunctionHref, never>,
) => number;

export type GetChaptersFunction<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = (
  params: {
    resourceHref: CrawHref;
    documentParams?: DocumentParams;
  },
  metadata: Metadata,
) => Promise<Required<T>[]>;

export type GetPageContentParams<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = {
  resourceHref: T;
  chapterParams: ChapterParams;
};

type CrawlerArgs = Omit<GenreParams, 'genre'> & {
  name: string;
  getMetadata: GetMetadataListFunction;
  filterMetadata?: FilterMetadataFunction;
  filterCheckpointTask?: FilterCheckpointFunction;
  sortCheckpointTask?: SortCheckpointFunction;
  filterCheckpointSubtask?: FilterSubtasksFunction;
  sortCheckpointSubtask?: SortSubtasksFunction;
  skipCheckpointCheck?: boolean;
  skipSubtaskCheckpointCheck?: boolean;
  getChapters: GetChaptersFunction;
  handlers: Array<
    | CrawlerWorkerHandler<GetPageContentParams, ChapterTreeOutput, Metadata>
    | CrawlerWorkerHandler<GetPageContentParams, string, Metadata>
    | CrawlerWorkerHandler<GetPageContentParams, void, Metadata>
  >;
  checkpointFilePath?: string;
  outputFileDir?: string;
  checkpointOptions?: WithCheckpointOptions<Metadata>;
  crawlerCount?: number;
  subTaskConcurrencyLimit?: number;
};

async function runWithConcurrency<T>(
  items: Iterable<T> | AsyncIterable<T>,
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  // eslint-disable-next-line no-restricted-syntax
  for await (const item of items) {
    const promise = task(item).finally(() => executing.delete(promise));
    executing.add(promise);
    if (executing.size >= limit) {
      await Promise.race(executing); // Wait for at least one to finish before adding more
    }
  }
  await Promise.all(executing); // Drain the remaining promises
}

class Crawler {
  name: string;

  domainParams: Omit<GenreParams, 'genre'>;

  checkpointFilePath: string;

  outputFileDir: string;

  manifestList: {
    documentId: string;
    chapterNumber: number;
    filePath: string;
  }[] = [];

  getMetadata: GetMetadataListFunction;

  filterMetadata?: FilterMetadataFunction;

  filterCheckpointTask: FilterCheckpointFunction;

  sortCheckpointTask?: SortCheckpointFunction;

  filterCheckpointSubtask?: FilterSubtasksFunction;

  sortCheckpointSubtask?: SortSubtasksFunction;

  skipCheckpointCheck?: boolean;

  skipSubtaskCheckpointCheck?: boolean;

  getChapters: GetChaptersFunction;

  handlers: Array<
    | CrawlerWorkerHandler<GetPageContentParams, ChapterTreeOutput, Metadata>
    | CrawlerWorkerHandler<GetPageContentParams, string, Metadata>
    | CrawlerWorkerHandler<GetPageContentParams, void, Metadata>
  >;

  checkpointOptions: WithCheckpointOptions<Metadata>;

  logFilePath?: string;

  crawlerCount: number;

  subTaskConcurrencyLimit: number;

  runId?: string;

  constructor(args: CrawlerArgs) {
    this.name = args.name;
    this.domainParams = {
      domain: args.domain,
      subDomain: args.subDomain,
    };

    this.getMetadata = args.getMetadata;
    this.filterMetadata = args.filterMetadata;
    this.filterCheckpointTask =
      args?.filterCheckpointTask || defaultFilterCheckpoint;
    this.sortCheckpointTask = args?.sortCheckpointTask || sortCheckpointAsc;
    this.filterCheckpointSubtask =
      args?.filterCheckpointSubtask || defaultFilterCheckpoint;
    this.sortCheckpointSubtask = args?.sortCheckpointSubtask;

    this.skipCheckpointCheck = args.skipCheckpointCheck ?? true;
    this.skipSubtaskCheckpointCheck = args.skipSubtaskCheckpointCheck ?? true;

    this.getChapters = args.getChapters;
    this.handlers = args.handlers;

    if (!args.checkpointFilePath) {
      args.checkpointFilePath = path.join(
        DEFAULT_CHECKPOINT_DIR,
        `${args.domain}${args.subDomain}-${args.name}-checkpoint.json`,
      );
    }

    this.checkpointFilePath = args.checkpointFilePath;

    this.outputFileDir = args.outputFileDir || DEFAULT_OUTPUT_FILE_DIR;

    this.checkpointOptions = args.checkpointOptions || {};

    this.crawlerCount = args.crawlerCount || DEFAULT_CRAWL_COUNT;

    this.subTaskConcurrencyLimit =
      args.subTaskConcurrencyLimit || DEFAULT_SUB_TASK_CONCURRENCY_LIMIT;
  }

  private async checkManifestList() {
    const missingManifests = this.manifestList.filter(
      (manifest) => !existsSync(manifest.filePath),
    );

    missingManifests.forEach((manifest) => {
      logger.warn(
        `Manifest file missing for document ${manifest.documentId}, chapter ${manifest.chapterNumber}: ${manifest.filePath}`,
      );
    });

    if (missingManifests.length > 0) {
      logger.info(
        `Total missing manifest files: ${missingManifests.length}. Updating checkpoint file...`,
      );
    } else {
      logger.info('All manifest files are present.');
    }

    // NOTE: Update completed state of subtasks in the checkpoint file for missing manifests
    const checkpointData = await readCheckpointFile<
      Metadata,
      GetChaptersFunctionHref
    >(this.checkpointFilePath);

    const updatedCheckpointData = checkpointData.map((checkpoint) => {
      const updatedSubtasks = checkpoint.subtasks?.map((subtask) => {
        const manifestExists = !missingManifests.some(
          (manifest) =>
            manifest.documentId === checkpoint.params.documentId &&
            manifest.chapterNumber === subtask.params.props?.chapterNumber,
        );

        return {
          ...subtask,
          completed: manifestExists,
        };
      });

      return {
        ...checkpoint,
        subtasks: updatedSubtasks,
      };
    });

    writeFileSync(
      this.checkpointFilePath,
      JSON.stringify(updatedCheckpointData, null, 2),
    );
  }

  async run() {
    this.runId = randomUUID();

    // NOTE: Get saved checkpoint
    const {
      filteredCheckpoint: metadataCheckpoint,
      setSubtaskComplete,
      setCheckpointComplete,
    } = await withCheckpoint<Metadata, GetChaptersFunctionHref>({
      getInitialData: this.getMetadata,

      getSubtaskData: async (checkpoint) => {
        const parseRes = MetadataSchema.safeParse(checkpoint.params);

        if (!parseRes.success) {
          logger.error('Error parsing metadata checkpoint', {
            id: checkpoint.id,
            error: z.prettifyError(parseRes.error),
          });

          return [];
        }

        const metadata = parseRes.data;

        const documentParams = {
          ...this.domainParams,
          genre: metadata.genre.code,
          documentNumber: +metadata.documentNumber,
        };

        let chapterCrawlList: Awaited<ReturnType<GetChaptersFunction>> = [
          {
            href: metadata.sourceURL,
            props: {
              chapterNumber: 1,
            },
          },
        ];

        if (metadata.hasChapters) {
          try {
            chapterCrawlList = await this.getChapters(
              {
                resourceHref: { href: metadata.sourceURL },
                documentParams,
              },
              metadata,
            );
          } catch (error) {
            logger.error(
              `Error getting chapters for document ${metadata.documentId}:`,
              {
                href: metadata.sourceURL,
                error:
                  error instanceof ZodError ? z.prettifyError(error) : error,
              },
              error,
            );

            return [];
          }
        }

        return chapterCrawlList;
      },
      getSubtaskId: (checkpoint, subtaskData) => subtaskData.href,
      getCheckpointId: (data) => data.documentId,
      filterCheckpoint: this.filterCheckpointTask,
      sortCheckpoint: this.sortCheckpointTask,
      filterSubtasks: this.filterCheckpointSubtask,
      sortSubtasks: this.sortCheckpointSubtask,
      skipCheckpointCheck: this.skipCheckpointCheck,
      skipSubtaskCheckpointCheck: this.skipSubtaskCheckpointCheck,
      checkpointFilePath: this.checkpointFilePath,
      options: this.checkpointOptions,
    });

    await runWithConcurrency(
      metadataCheckpoint.entries(),
      this.crawlerCount,
      async ([shardIndex, checkpoint]) => {
        const metadata = checkpoint.params;

        // NOTE: Hoist invariant variables out of the inner loop
        const documentParams = {
          ...this.domainParams,
          genre: metadata.genre.code,
          documentNumber: +metadata.documentNumber,
        };

        const subtasks = checkpoint.subtasks || [];
        const CONCURRENCY_LIMIT = 5; // Adjust this based on your worker's resource intensity

        // NOTE: Process subtasks concurrently with a strict limit
        await runWithConcurrency(
          subtasks,
          CONCURRENCY_LIMIT,
          async (subtask) => {
            const { href, props } = subtask.params;

            const chapterParams = {
              ...documentParams,
              chapterNumber: props?.chapterNumber || 1,
              chapterName: props?.chapterName || '',
            };

            const getFileNameParams = {
              ...chapterParams,
              documentTitle: metadata.title,
            } satisfies Omit<
              Parameters<GetDefaultDocumentPathFunction>['0'],
              'extension'
            >;

            await new Worker({
              shardIndex,
              handlers: this.handlers.map((handler) => ({
                handler: {
                  ...handler.handler,
                  onStart: ((...params) => {
                    handler.handler.onStart?.(...params);

                    if (handler.handler.output) {
                      const manifestFileName =
                        handler.handler.output.getFileName({
                          ...getFileNameParams,
                          extension: handler.handler.output.extension,
                        });

                      const manifestFilePath = path.join(
                        this.outputFileDir,
                        manifestFileName,
                      );

                      this.manifestList = this.manifestList.concat({
                        documentId: metadata.documentId,
                        chapterNumber: chapterParams.chapterNumber,
                        filePath: manifestFilePath,
                      });
                    }
                  }) satisfies typeof handler.handler.onStart,
                },
                stringify: handler.stringify?.map((stringify) => {
                  return {
                    ...stringify,
                    onFinish: (content) => {
                      stringify.onFinish?.(content);

                      if (stringify.output) {
                        const manifestFileName = stringify.output.getFileName({
                          ...getFileNameParams,
                          extension: stringify.output.extension,
                        });

                        const manifestFilePath = path.join(
                          this.outputFileDir,
                          manifestFileName,
                        );

                        this.manifestList = this.manifestList.concat({
                          documentId: metadata.documentId,
                          chapterNumber: chapterParams.chapterNumber,
                          filePath: manifestFilePath,
                        });

                        writeFileSync(manifestFilePath, content);
                      }
                    },
                  };
                }),
                onStringifyFinish: (log?: Logger) => {
                  handler.onStringifyFinish?.(log);
                  setSubtaskComplete(checkpoint.id, subtask.id, true);
                },
                onStringifyError: (error: Error, log?: Logger) => {
                  handler.onStringifyError?.(error, log);
                  logger.error(
                    `Error in stringify for chapter ${chapterParams.chapterNumber} of document ${metadata.documentId}:`,
                    { href, error },
                  );
                },
              })),
            }).run(
              {
                resourceHref: { href, props },
                chapterParams,
              },
              metadata,
            );
          },
        );

        setCheckpointComplete(checkpoint.id, true);
      },
    );

    await this.checkManifestList();
  }
}

export { Crawler };
