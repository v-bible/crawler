import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { groupBy, shuffle } from 'es-toolkit';
import { Logger } from 'winston';
import { ZodError, z } from 'zod';
import { getDocumentId } from './getId';
import {
  DEFAULT_ALLOW_MISSING_MANIFEST,
  DEFAULT_CACHE_HANDLER_DATA,
  DEFAULT_CHECKPOINT_DIR,
  DEFAULT_CRAWL_COUNT,
  DEFAULT_ONLY_CHECK_MANIFEST,
  DEFAULT_OUTPUT_FILE_DIR,
  DEFAULT_RECRAWL_ALLOW_MISSING_MANIFEST,
  DEFAULT_SUB_TASK_CONCURRENCY_LIMIT,
} from '@/constants';
import {
  type Checkpoint,
  type WithCheckpointOptions,
  WithCheckpointParams,
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
    | CrawlerWorkerHandler<GetPageContentParams, undefined, Metadata>
  >;
  checkpointFilePath?: string;
  outputFileDir?: string;
  checkpointOptions?: WithCheckpointOptions<Metadata>;
  crawlerCount?: number;
  subTaskConcurrencyLimit?: number;
  onlyCheckManifest?: boolean;
  recrawlAllowMissingManifest?: boolean;
  cacheHandlerData?: boolean;
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
    | CrawlerWorkerHandler<GetPageContentParams, undefined, Metadata>
  >;

  checkpointOptions: WithCheckpointOptions<Metadata>;

  logFilePath?: string;

  crawlerCount: number;

  subTaskConcurrencyLimit: number;

  runId?: string;

  onlyCheckManifest?: boolean;

  recrawlAllowMissingManifest?: boolean;

  cacheHandlerData?: boolean;

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

    this.onlyCheckManifest =
      args.onlyCheckManifest || DEFAULT_ONLY_CHECK_MANIFEST;

    this.recrawlAllowMissingManifest =
      args.recrawlAllowMissingManifest ||
      DEFAULT_RECRAWL_ALLOW_MISSING_MANIFEST;

    this.cacheHandlerData = args.cacheHandlerData || DEFAULT_CACHE_HANDLER_DATA;
  }

  private getCacheHandlerData<TData>(
    name: string,
    metadata: Metadata,
  ): {
    data?: TData;
    setCache: (data: TData) => void;
  } {
    const cacheFilePath = path.join(
      this.outputFileDir,
      'cache',
      getDocumentId({
        ...this.domainParams,
        genre: metadata.genre.code,
        documentNumber: metadata.documentNumber,
      }),
      name,
    );

    const setCache = (data: TData) => {
      try {
        // NOTE: Only write cache file if data is not undefined
        if (data) {
          mkdirSync(path.dirname(cacheFilePath), { recursive: true });
          writeFileSync(cacheFilePath, JSON.stringify(data));
          logger.info(`Cache file written successfully to ${cacheFilePath}`);
        }
      } catch (error) {
        logger.error(`Error writing cache file ${cacheFilePath}:`, error);
      }
    };

    // NOTE: Return cached data if it exists
    if (existsSync(cacheFilePath)) {
      try {
        const cachedData = readFileSync(cacheFilePath, 'utf8');
        return {
          data: JSON.parse(cachedData) as TData,
          setCache,
        };
      } catch (error) {
        logger.error(`Error reading cache file ${cacheFilePath}:`, error);
      }
    }

    return {
      data: undefined,
      setCache,
    };
  }

  private async checkManifestList() {
    logger.info('Checking manifest files...');

    const { filteredCheckpoint: data } = await this.getData({
      options: {
        forceAll: true,
        forceAllSubtasks: true,
      },
    });

    let manifestFile: {
      documentId: string;
      chapterNumber: number;
      filePath: string;
      allowMissing?: boolean;
    }[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const checkpoint of data) {
      const metadata = checkpoint.params;

      const documentParams = {
        ...this.domainParams,
        genre: metadata.genre.code,
        documentNumber: +metadata.documentNumber,
      };

      // eslint-disable-next-line no-restricted-syntax
      for await (const subtask of checkpoint.subtasks || []) {
        const { props } = subtask.params;

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

        const handlers = this.handlers.filter((handler) => {
          if (subtask.skipHandler?.includes(handler.handler.name)) {
            logger.info(
              `Skipping handler ${handler.handler.name} for subtask ${subtask.id} of checkpoint ${checkpoint.id}`,
            );
            return false;
          }
          return true;
        });

        // eslint-disable-next-line no-loop-func
        handlers.forEach((handler) => {
          if (handler.handler.output) {
            const manifestFileName = handler.handler.output.getFileName({
              ...getFileNameParams,
              extension: handler.handler.output.extension,
              suffix: handler.handler.output.suffix,
            });

            const manifestFilePath = path.join(
              this.outputFileDir,
              manifestFileName,
            );

            manifestFile = manifestFile.concat({
              documentId: metadata.documentId,
              chapterNumber: chapterParams.chapterNumber,
              filePath: manifestFilePath,
              allowMissing:
                handler.handler.output.allowMissing ||
                DEFAULT_ALLOW_MISSING_MANIFEST,
            });
          }

          handler.stringify?.forEach((stringify) => {
            if (stringify.output) {
              const manifestFileName = stringify.output.getFileName({
                ...getFileNameParams,
                extension: stringify.output.extension,
                suffix: stringify.output.suffix,
              });

              const manifestFilePath = path.join(
                this.outputFileDir,
                manifestFileName,
              );

              manifestFile = manifestFile.concat({
                documentId: metadata.documentId,
                chapterNumber: chapterParams.chapterNumber,
                filePath: manifestFilePath,
                allowMissing:
                  stringify.output.allowMissing ||
                  DEFAULT_ALLOW_MISSING_MANIFEST,
              });
            }
          });
        });
      }
    }

    const missingManifests = manifestFile.filter((manifest) => {
      if (!existsSync(manifest.filePath)) {
        return true;
      }

      const buffer = readFileSync(manifest.filePath);
      // NOTE: Check non-empty file
      return buffer.length === 0;
    });

    missingManifests.forEach((manifest) => {
      logger.warn(
        `Manifest file ${manifest.allowMissing ? 'is allowed to be missing' : 'is missing'} for document ${manifest.documentId}, chapter ${manifest.chapterNumber}: ${manifest.filePath}`,
      );
    });

    if (missingManifests.length > 0) {
      const groupByDocumentId = groupBy(
        missingManifests,
        (manifest) => manifest.documentId,
      );
      const groupByChapterNumber = groupBy(
        missingManifests,
        (manifest) => manifest.chapterNumber,
      );

      const missingTaskCount = Object.keys(groupByDocumentId).length;
      const missingSubtaskCount = Object.keys(groupByChapterNumber).length;
      const allowMissingCount = missingManifests.filter(
        (manifest) => manifest.allowMissing,
      ).length;

      logger.info(
        `Total missing manifest files: ${missingManifests.length}. Missing manifests by document: ${missingTaskCount}. Missing manifests by chapter: ${missingSubtaskCount}. Allowed missing manifests: ${allowMissingCount}. Updating checkpoint file...`,
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
        const manifestExists = !missingManifests.some((manifest) => {
          if (
            manifest.documentId === checkpoint.params.documentId &&
            manifest.chapterNumber === subtask.params.props?.chapterNumber
          ) {
            if (manifest.allowMissing && !this.recrawlAllowMissingManifest) {
              return false; // Allow missing manifest and recrawl is not enabled, so treat it as existing
            }
            if (manifest.allowMissing && this.recrawlAllowMissingManifest) {
              return true; // Allow missing manifest and recrawl is enabled, so treat it as missing
            }

            return true; // Manifest is missing and not allowed to be missing
          }

          return false; // Manifest is not related to this subtask
        });

        return {
          ...subtask,
          completed: manifestExists,
        };
      });

      const updateCheckpointCompleted = updatedSubtasks?.every(
        (subtask) => subtask.completed,
      );

      return {
        ...checkpoint,
        subtasks: updatedSubtasks,
        completed: updateCheckpointCompleted,
      };
    });

    writeFileSync(
      this.checkpointFilePath,
      JSON.stringify(updatedCheckpointData, null, 2),
    );

    logger.info(
      `Checkpoint file updated successfully: ${this.checkpointFilePath}`,
    );
  }

  getData(
    checkpointParams?: Partial<
      WithCheckpointParams<Metadata, GetChaptersFunctionHref>
    >,
  ) {
    // NOTE: Get saved checkpoint
    return withCheckpoint<Metadata, GetChaptersFunctionHref>({
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

      ...checkpointParams,
    });
  }

  async run() {
    if (this.onlyCheckManifest) {
      await this.checkManifestList();
      return;
    }

    this.runId = randomUUID();

    // NOTE: Get saved checkpoint
    const {
      filteredCheckpoint: metadataCheckpoint,
      setSubtaskComplete,
      setCheckpointComplete,
    } = await this.getData();

    await runWithConcurrency(
      shuffle(metadataCheckpoint).entries(),
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

        const failedCheckpoint: Set<string> = new Set();

        // NOTE: Process subtasks concurrently with a strict limit
        await runWithConcurrency(
          // NOTE: Shuffle the subtasks to avoid processing them in a predictable order
          shuffle(subtasks),
          this.subTaskConcurrencyLimit,
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

            const handlers = this.handlers.filter((handler) => {
              if (subtask.skipHandler?.includes(handler.handler.name)) {
                logger.info(
                  `Skipping handler ${handler.handler.name} for subtask ${subtask.id} of checkpoint ${checkpoint.id}`,
                );
                return false;
              }
              return true;
            });

            await new Worker({
              shardIndex,
              handlers: handlers.map((handler) => ({
                handler: {
                  ...handler.handler,
                  fn: (async (params, meta, signal) => {
                    if (!this.cacheHandlerData) {
                      return handler.handler.fn(params, meta, signal);
                    }

                    const { data: cachedData, setCache } =
                      this.getCacheHandlerData<
                        Awaited<ReturnType<typeof handler.handler.fn>>
                      >(handler.handler.name, meta);

                    if (cachedData !== undefined) {
                      return cachedData;
                    }

                    const newCacheData = await handler.handler.fn(
                      params,
                      meta,
                      signal,
                    );
                    if (newCacheData) {
                      setCache(newCacheData);
                    }

                    return newCacheData;
                  }) satisfies WorkerHandler<
                    GetPageContentParams,
                    unknown,
                    Metadata
                  >['handler']['fn'],
                  onError: (error, log) => {
                    handler.handler.onError?.(error, log);

                    failedCheckpoint.add(checkpoint.id);

                    log?.error(
                      `Error occurred while processing subtask ${subtask.id} for checkpoint ${checkpoint.id}: ${error.message}`,
                      {
                        checkpointId: checkpoint.id,
                        subtaskId: subtask.id,
                        error,
                      },
                    );
                  },
                },
                stringify: handler.stringify?.map((stringify) => {
                  return {
                    ...stringify,
                    onFinish: (content, log) => {
                      stringify.onFinish?.(content);

                      if (stringify.output) {
                        const manifestFileName = stringify.output.getFileName({
                          ...getFileNameParams,
                          extension: stringify.output.extension,
                          suffix: stringify.output.suffix,
                        });

                        const manifestFilePath = path.join(
                          this.outputFileDir,
                          manifestFileName,
                        );

                        mkdirSync(path.dirname(manifestFilePath), {
                          recursive: true,
                        });

                        writeFileSync(manifestFilePath, content);

                        log?.info(
                          `File written successfully to ${manifestFilePath}`,
                        );
                      }
                    },
                    onError: (error: Error, log?: Logger) => {
                      stringify.onError?.(error, log);

                      failedCheckpoint.add(checkpoint.id);

                      log?.error(
                        `Error occurred while processing subtask ${subtask.id} for checkpoint ${checkpoint.id}: ${error.message}`,
                        {
                          checkpointId: checkpoint.id,
                          subtaskId: subtask.id,
                          error,
                        },
                      );
                    },
                  };
                }),
              })),
              onWorkerSuccess: () => {
                setSubtaskComplete(checkpoint.id, subtask.id, true);
              },
            }).run(
              {
                resourceHref: { href, props },
                chapterParams,
              },
              metadata,
            );
          },
        );

        if (
          [...failedCheckpoint].some(
            (failedId) => failedId === checkpoint.id,
          ) === false
        ) {
          setCheckpointComplete(checkpoint.id, true);
        }
      },
    );

    await this.checkManifestList();
  }
}

export { Crawler };
