import { randomUUID } from 'crypto';
import path from 'path';
import { chunk } from 'es-toolkit';
import { Logger } from 'winston';
import { ZodError, z } from 'zod';
import {
  DEFAULT_CHECKPOINT_DIR,
  DEFAULT_CRAWL_COUNT,
  DEFAULT_OUTPUT_FILE_DIR,
} from '@/constants';
import {
  type Checkpoint,
  type WithCheckpointOptions,
  withCheckpoint,
} from '@/lib/crawler/checkpoint';
import {
  writeChapterContent,
  writeChapterContentBuffer,
} from '@/lib/crawler/fileUtils';
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
import { Worker, type WorkerHandler } from '@/lib/crawler/worker';
import { logger } from '@/logger/logger';

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
> = (params: {
  resourceHref: CrawHref;
  documentParams?: DocumentParams;
  metadata?: Metadata;
}) => Promise<Required<T>[]>;

export type GetPageContentParams<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = {
  resourceHref: T;
  chapterParams: ChapterParams;
  metadata: Metadata;
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
    | WorkerHandler<GetPageContentParams, ChapterTreeOutput>
    | WorkerHandler<GetPageContentParams, string>
    | WorkerHandler<GetPageContentParams, void>
  >;
  checkpointFilePath?: string;
  outputFileDir?: string;
  checkpointOptions?: WithCheckpointOptions<Metadata>;
  crawlerCount?: number;
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

  metadataList: Metadata[] = [];

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
    | WorkerHandler<GetPageContentParams, ChapterTreeOutput>
    | WorkerHandler<GetPageContentParams, string>
    | WorkerHandler<GetPageContentParams, void>
  >;

  checkpointOptions: WithCheckpointOptions<Metadata>;

  logFilePath?: string;

  crawlerCount: number;

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
            chapterCrawlList = await this.getChapters({
              resourceHref: { href: metadata.sourceURL },
              documentParams,
              metadata,
            });
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

    const shardSize = Math.ceil(metadataCheckpoint.length / this.crawlerCount);
    const metadataShards = chunk(metadataCheckpoint, shardSize);

    await Promise.all(
      metadataShards.map(async (metadataShard, shardIndex) => {
        // eslint-disable-next-line no-restricted-syntax
        for await (const checkpoint of metadataShard) {
          // NOTE: Hoist invariant variables out of the inner loop
          const documentParams = {
            ...this.domainParams,
            genre: checkpoint.params.genre.code,
            documentNumber: +checkpoint.params.documentNumber,
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

              await new Worker({
                shardIndex,
                handlers: this.handlers.map((handler) => ({
                  ...handler,
                  stringify: handler.stringify?.map((stringify) => {
                    return {
                      ...stringify,
                      onFinish: (
                        content,
                        extension,
                        getFileName,
                        log?: Logger,
                      ) => {
                        stringify.onFinish?.(
                          content,
                          extension,
                          getFileName,
                          log,
                        );

                        const logConfig = {
                          name: stringify.name,
                          documentId: checkpoint.params.documentId,
                          href,
                        };

                        if (typeof content === 'string') {
                          writeChapterContent({
                            getFileName,
                            params: chapterParams,
                            content,
                            extension,
                            documentTitle: checkpoint.params.title,
                            baseDir: this.outputFileDir,
                            log: log?.child(logConfig),
                          });
                        } else if (Buffer.isBuffer(content)) {
                          writeChapterContentBuffer({
                            getFileName,
                            params: chapterParams,
                            content,
                            extension,
                            documentTitle: checkpoint.params.title,
                            baseDir: this.outputFileDir,
                            log: log?.child(logConfig),
                          });
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
                      `Error in stringify for chapter ${chapterParams.chapterNumber} of document ${checkpoint.params.documentId}:`,
                      { href, error },
                    );
                  },
                })),
              }).run({
                resourceHref: { href, props },
                chapterParams,
                metadata: checkpoint.params,
              });
            },
          );

          setCheckpointComplete(checkpoint.id, true);
        }
      }),
    );
  }
}

export { Crawler };
