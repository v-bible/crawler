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
import { getPdfBase } from '@/sites/rongmotamhon.net/getPdf';

export const crawler = new Crawler({
  name: 'rongmotamhon.net',
  domain: 'R',
  subDomain: 'B',
  crawlerCount: 2,
  subTaskConcurrencyLimit: 2,
  getMetadata: getMetadataList,
  sortCheckpointTask: sortCheckpointAsc,
  filterCheckpointTask: filterChapterCheckpoint,
  getChapters,
  handlers: [
    defineHandler({
      handler: {
        name: 'getPageContent',
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
        name: 'getPageContentVie',
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
      handler: {
        name: 'getPageContentMdVie',
        fn: getPageContentMdVie,
      },
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
      handler: {
        name: 'getPdfCanLong',
        fn: getPdfBase({ label: 'Càn Long', suffix: '_can-long' }),
        output: {
          extension: 'pdf',
          suffix: '_can-long',
          getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          allowMissing: true, // Allow missing for Càn Long PDF since it may not be available for all chapters
        },
      },
    }),
    defineHandler({
      handler: {
        name: 'getPdfVinhLac',
        fn: getPdfBase({ label: 'Vĩnh Lạc', suffix: '_vinh-lac' }),
        output: {
          extension: 'pdf',
          suffix: '_vinh-lac',
          getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          allowMissing: true, // Allow missing for Càn Long PDF since it may not be available for all chapters
        },
      },
    }),
    defineHandler({
      handler: {
        name: 'getPdfCBETA',
        fn: getPdfBase({ label: 'CBETA', suffix: '_cbeta' }),
        output: {
          extension: 'pdf',
          suffix: '_cbeta',
          getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          allowMissing: false,
        },
      },
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
