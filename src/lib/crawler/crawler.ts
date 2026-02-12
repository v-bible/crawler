import path from 'path';
import { ZodError, z } from 'zod';
import {
  DEFAULT_CHECKPOINT_DIR,
  DEFAULT_CRAWL_TIMEOUT_MS,
  DEFAULT_OUTPUT_FILE_DIR,
} from '@/constants';
import Bluebird, { withBluebirdTimeout } from '@/lib//bluebird';
import {
  type Checkpoint,
  type WithCheckpointOptions,
  withCheckpoint,
} from '@/lib/crawler/checkpoint';
import {
  type GetDefaultDocumentPathFunction,
  writeChapterContent,
} from '@/lib/crawler/fileUtils';
import { defaultFilterCheckpoint } from '@/lib/crawler/filterUtils';
import {
  type ChapterParams,
  type DocumentParams,
  type GenreParams,
  type Metadata,
  type MetadataOutput,
  MetadataSchema,
  type Page,
  PageSchema,
  type SentenceHeading,
  type TreeFootnote,
} from '@/lib/crawler/schema';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import {
  type GenerateTreeFunction,
  type StringifyTreeFunction,
  generateDataTree,
  generateJsonTree,
  generateXmlTree,
} from '@/lib/crawler/treeUtils';
import { logger } from '@/logger/logger';

export const defaultStringifyFunctions: StringifyTreeFunction[] = [
  generateXmlTree,
  generateJsonTree,
];

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
}) => Bluebird<Required<T>[]>;

export type GetPageContentParams<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = {
  resourceHref: T;
  chapterParams: ChapterParams;
  metadata?: Metadata;
};

export type GetPageContentFunction<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = (params: GetPageContentParams<T>) => Bluebird<Page[]>;

export type GetPageContentMdFunction<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = (params: GetPageContentParams<T>) => Bluebird<string>;

export type GetPageExtraContentFunction<
  T extends GetChaptersFunctionHref = GetChaptersFunctionHref,
> = (params: GetPageContentParams<T>) => Bluebird<void>;

export type GetPageContentHandler = {
  metadataFilePath?: string;
  outputDir?: string;
  inputFn: GetPageContentFunction;
  outputFn?: GenerateTreeFunction;
  stringifyFn?: StringifyTreeFunction | StringifyTreeFunction[];
  getFileName?: GetDefaultDocumentPathFunction;
  extraContentFn?: GetPageExtraContentFunction | GetPageExtraContentFunction[];
};

class Crawler {
  name: string;

  domainParams: Omit<GenreParams, 'genre'>;

  checkpointFilePath: string;

  outputFileDir: string;

  metadataList: Metadata[] = [];

  getMetadataList: GetMetadataListFunction;

  filterMetadata?: FilterMetadataFunction;

  filterCheckpoint: FilterCheckpointFunction;

  sortCheckpoint?: SortCheckpointFunction;

  filterSubtasks?: FilterSubtasksFunction;

  sortSubtasks?: SortSubtasksFunction;

  skipCheckpointCheck?: boolean;

  skipSubtaskCheckpointCheck?: boolean;

  getChapters: GetChaptersFunction;

  getPageContentHandler: GetPageContentHandler | GetPageContentHandler[] = [];

  // NOTE: Optional function to get page content in Markdown format
  getPageContentMd?: GetPageContentMdFunction;

  checkpointOptions: WithCheckpointOptions<Metadata>;

  timeout: number;

  constructor(
    args: Omit<GenreParams, 'genre'> & {
      name: string;
      getMetadataList: GetMetadataListFunction;
      getMetadataBy?: FilterMetadataFunction;
      filterCheckpoint?: FilterCheckpointFunction;
      sortCheckpoint?: SortCheckpointFunction;
      filterSubtasks?: FilterSubtasksFunction;
      sortSubtasks?: SortSubtasksFunction;
      skipCheckpointCheck?: boolean;
      skipSubtaskCheckpointCheck?: boolean;
      getChapters: GetChaptersFunction;
      getPageContentHandler: GetPageContentHandler | GetPageContentHandler[];
      getPageContentMd?: GetPageContentMdFunction;
      checkpointFilePath?: string;
      outputFileDir?: string;
      checkpointOptions?: WithCheckpointOptions<Metadata>;
      timeout?: number;
    },
  ) {
    this.name = args.name;
    this.domainParams = {
      domain: args.domain,
      subDomain: args.subDomain,
    };

    this.getMetadataList = args.getMetadataList;
    this.filterMetadata = args.getMetadataBy;
    this.filterCheckpoint = args.filterCheckpoint || defaultFilterCheckpoint;
    this.sortCheckpoint = args.sortCheckpoint || sortCheckpointAsc;
    this.filterSubtasks = args?.filterSubtasks || defaultFilterCheckpoint;
    this.sortSubtasks = args?.sortSubtasks;

    this.skipCheckpointCheck = args.skipCheckpointCheck || true;
    this.skipSubtaskCheckpointCheck = args.skipSubtaskCheckpointCheck || true;

    this.getChapters = args.getChapters;
    this.getPageContentHandler = args.getPageContentHandler || [];
    this.getPageContentMd = args.getPageContentMd;

    if (!args.checkpointFilePath) {
      args.checkpointFilePath = path.join(
        DEFAULT_CHECKPOINT_DIR,
        `${args.domain}${args.subDomain}-${args.name}-checkpoint.json`,
      );
    }

    this.checkpointFilePath = args.checkpointFilePath;

    this.outputFileDir = args.outputFileDir || DEFAULT_OUTPUT_FILE_DIR;

    this.checkpointOptions = args.checkpointOptions || {};

    this.timeout = args.timeout || DEFAULT_CRAWL_TIMEOUT_MS;
  }

  async run() {
    // NOTE: Get saved checkpoint
    const {
      filteredCheckpoint: metadataCheckpoint,
      setSubtaskComplete,
      setCheckpointComplete,
    } = await withCheckpoint<Metadata, GetChaptersFunctionHref>({
      getInitialData: async () =>
        (await this.getMetadataList()).filter(
          (metadata) => this.filterMetadata?.(metadata) ?? true,
        ),

      getSubtaskData: async (checkpoint) => {
        const parseRes = MetadataSchema.safeParse(checkpoint.params);

        if (!parseRes.success) {
          logger.error('Error parsing metadata checkpoint', {
            id: checkpoint.id,
            error: z.prettifyError(parseRes.error),
          });

          // eslint-disable-next-line no-continue
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
            chapterCrawlList = await withBluebirdTimeout(
              () =>
                this.getChapters({
                  resourceHref: { href: metadata.sourceURL },
                  documentParams,
                  metadata,
                }),
              this.timeout,
            );
          } catch (error) {
            logger.error(
              `Error getting chapters for document ${metadata.documentId}:`,
              {
                href: metadata.sourceURL,
                error:
                  error instanceof ZodError ? z.prettifyError(error) : error,
              },
            );

            // eslint-disable-next-line no-continue
            return [];
          }
        }

        return chapterCrawlList;
      },
      getSubtaskId: (checkpoint, subtaskData) => subtaskData.href,

      getCheckpointId: (data) => data.documentId,
      filterCheckpoint: this.filterCheckpoint,
      sortCheckpoint: this.sortCheckpoint,
      filterSubtasks: this.filterSubtasks,
      sortSubtasks: this.sortSubtasks,

      skipCheckpointCheck: this.skipCheckpointCheck,
      skipSubtaskCheckpointCheck: this.skipSubtaskCheckpointCheck,

      filePath: this.checkpointFilePath,
      options: this.checkpointOptions,
    });

    // eslint-disable-next-line no-restricted-syntax
    for await (const checkpoint of metadataCheckpoint) {
      const parseRes = MetadataSchema.safeParse(checkpoint.params);

      if (!parseRes.success) {
        logger.error('Error parsing metadata checkpoint', {
          id: checkpoint.id,
          error: z.prettifyError(parseRes.error),
        });

        // eslint-disable-next-line no-continue
        continue;
      }

      const metadata = parseRes.data;

      const documentParams = {
        ...this.domainParams,
        genre: metadata.genre.code,
        documentNumber: +metadata.documentNumber,
      };

      const subtasks = checkpoint?.subtasks || [];

      const isAllSubtasksComplete = subtasks.every(
        (subtask) => subtask.completed,
      );

      // If all subtasks are complete, mark checkpoint complete and skip
      if (isAllSubtasksComplete) {
        setCheckpointComplete(checkpoint.id, true);
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-restricted-syntax
      for await (const subtask of subtasks) {
        // Track if this specific subtask processed successfully
        let subtaskSuccessful = true;
        const { href, props } = subtask.params;

        const chapterParams = {
          ...documentParams,
          chapterNumber: props?.chapterNumber || 1,
          chapterName: props?.chapterName || '',
        };

        const handlerFn = Array.isArray(this.getPageContentHandler)
          ? this.getPageContentHandler
          : [this.getPageContentHandler];

        // eslint-disable-next-line no-restricted-syntax
        for await (const handler of handlerFn) {
          let stringifyFnArr: StringifyTreeFunction[];
          let extraContentFnArr: GetPageExtraContentFunction[] = [];

          if (handler && handler.stringifyFn) {
            if (Array.isArray(handler.stringifyFn)) {
              stringifyFnArr = handler.stringifyFn.filter(
                Boolean,
              ) as StringifyTreeFunction[];
            } else {
              stringifyFnArr = [handler.stringifyFn];
            }
          } else {
            stringifyFnArr = defaultStringifyFunctions;
          }

          if (handler && handler.extraContentFn) {
            if (Array.isArray(handler.extraContentFn)) {
              extraContentFnArr = handler.extraContentFn.filter(
                Boolean,
              ) as GetPageExtraContentFunction[];
            } else {
              extraContentFnArr = [handler.extraContentFn];
            }
          }

          const outputFn = handler.outputFn || generateDataTree;

          try {
            const pageContent = await withBluebirdTimeout(
              () =>
                handler.inputFn({
                  resourceHref: { href, props },
                  chapterParams,
                  metadata,
                }),
              this.timeout,
            );

            const parsePageRes = PageSchema.array().safeParse(pageContent);

            if (!parsePageRes.success) {
              logger.error('Error parsing page content', {
                error: z.prettifyError(parsePageRes.error),
                href,
                chapterParams,
              });

              subtaskSuccessful = false;
              // eslint-disable-next-line no-continue
              continue;
            }

            const treeFootnotes = parsePageRes.data
              .flatMap((page) => {
                return page.sentences.flatMap((sentence) => {
                  if (sentence.type === 'single') {
                    return sentence?.footnotes || [];
                  }

                  return sentence.array.flatMap(
                    (lang) => lang?.footnotes || [],
                  );
                });
              })
              .map((footnote, idx) => ({
                ...footnote,
                order: idx,
              })) satisfies TreeFootnote[];

            const treeHeadings = parsePageRes.data.flatMap((page) => {
              return page.sentences.flatMap((sentence) => {
                return sentence.headings || [];
              });
            }) satisfies SentenceHeading[];

            const tree = outputFn({
              chapterParams,
              metadata,
              pages: parsePageRes.data,
              footnotes: treeFootnotes,
              headings: treeHeadings,
            });

            // eslint-disable-next-line no-restricted-syntax
            for (const stringify of stringifyFnArr) {
              const { content, extension } = stringify(tree);

              writeChapterContent({
                params: chapterParams,
                baseDir: this.outputFileDir,
                content,
                extension,
                documentTitle: metadata.title,
                getFileName: handler.getFileName,
              });
            }

            // eslint-disable-next-line no-restricted-syntax
            for await (const extraFn of extraContentFnArr) {
              try {
                await withBluebirdTimeout(
                  () =>
                    extraFn({
                      resourceHref: { href, props },
                      chapterParams,
                      metadata,
                    }),
                  this.timeout,
                );
              } catch (error) {
                subtaskSuccessful = false;
                logger.error(
                  `Error getting extra content for chapter ${props?.chapterNumber} of document ${metadata.documentId}:`,
                  {
                    href,
                    error:
                      error instanceof ZodError
                        ? z.prettifyError(error)
                        : error,
                  },
                );
              }
            }
          } catch (error) {
            subtaskSuccessful = false;
            logger.error(
              `Error processing data for chapter ${props?.chapterNumber} of document ${metadata.documentId}:`,
              {
                href,
                error:
                  error instanceof ZodError ? z.prettifyError(error) : error,
              },
            );
          }
        }

        if (this.getPageContentMd) {
          try {
            const mdContent = await withBluebirdTimeout(
              () =>
                this.getPageContentMd!({
                  resourceHref: { href, props },
                  chapterParams,
                  metadata,
                }),
              this.timeout,
            );

            writeChapterContent({
              params: chapterParams,
              baseDir: this.outputFileDir,
              content: mdContent,
              extension: 'md',
              documentTitle: metadata.title,
            });
          } catch (error) {
            subtaskSuccessful = false;
            logger.error(
              `Error getting MD content for chapter ${props?.chapterNumber} of document ${metadata.documentId}:`,
              {
                href,
                error:
                  error instanceof ZodError ? z.prettifyError(error) : error,
              },
            );
          }
        }

        // Only mark subtask complete if it processed successfully
        if (subtaskSuccessful) {
          setSubtaskComplete(checkpoint.id, subtask.id, true);
        }
      }

      // After processing all subtasks, check if all are now complete
      const allSubtasksNowComplete = subtasks.every(
        (subtask) => subtask.completed,
      );

      if (allSubtasksNowComplete) {
        setCheckpointComplete(checkpoint.id, true);
      }
    }
  }
}

export { Crawler };
