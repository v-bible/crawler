import { Crawler } from '@/lib/crawler/crawler';
import { getDefaultDocumentPath } from '@/lib/crawler/fileUtils';
import { filterChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import {
  stringifyCsvTree,
  stringifyJsonTree,
  stringifyXmlTree,
} from '@/lib/crawler/treeUtils';
import { defineGetFileNameFunction, defineHandler } from '@/lib/crawler/worker';
import { getChapters } from '@/sites/rongmotamhon.net/getChapters';
import { getMetadataList } from '@/sites/rongmotamhon.net/getMetadataList';
import { getPageContent } from '@/sites/rongmotamhon.net/getPageContent';
import { getPageContentMdVie } from '@/sites/rongmotamhon.net/getPageContentMdVie';
import { getPageContentVie } from '@/sites/rongmotamhon.net/getPageContentVie';
import { getPdf } from '@/sites/rongmotamhon.net/getPdf';

export const crawler = new Crawler({
  name: 'rongmotamhon.net',
  domain: 'R',
  subDomain: 'B',
  crawlerCount: 10,
  getMetadata: getMetadataList,
  sortCheckpointTask: sortCheckpointAsc,
  filterCheckpointTask: filterChapterCheckpoint,
  getChapters,
  handlers: [
    defineHandler({
      handler: {
        fn: getPageContent,
      },
      stringify: [
        {
          name: 'json',
          fn: stringifyJsonTree,
          output: {
            extension: 'json',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
        {
          name: 'xml',
          fn: stringifyXmlTree,
          output: {
            extension: 'xml',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
        {
          name: 'csv',
          fn: stringifyCsvTree,
          output: {
            extension: 'csv',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
      ],
    }),
    defineHandler({
      handler: {
        fn: getPageContentVie,
      },
      stringify: [
        {
          name: 'json',
          fn: stringifyJsonTree,
          output: {
            extension: 'json',
            suffix: '_vie',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
        {
          name: 'xml',
          fn: stringifyXmlTree,
          output: {
            extension: 'xml',
            suffix: '_vie',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
        {
          name: 'csv',
          fn: stringifyCsvTree,
          output: {
            extension: 'csv',
            suffix: '_vie',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
      ],
    }),
    defineHandler({
      handler: { fn: getPageContentMdVie },
      stringify: [
        {
          name: 'md',
          fn: (content) => content,
          output: {
            extension: 'md',
            suffix: '_vie',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
      ],
    }),
    defineHandler({
      handler: { fn: getPdf },
    }),
  ],
});

const main = async () => {
  await crawler.run();
};

// Run directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
