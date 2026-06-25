import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { Crawler } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { getDefaultDocumentPath } from '@/lib/crawler/fileUtils';
import { filterNonChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { stringifyJsonTree, stringifyXmlTree } from '@/lib/crawler/treeUtils';
import { defineGetFileNameFunction, defineHandler } from '@/lib/crawler/worker';
import { getPageContent } from '@/sites/dongten.net/getPageContent';
import { getPageContentMd } from '@/sites/dongten.net/getPageContentMd';

export const crawler = new Crawler({
  name: 'dongten.net',
  domain: 'R',
  subDomain: 'C',
  getMetadata: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
  filterMetadata: (metadataRow) => {
    return (
      metadataRow.source === 'dongten.net' && metadataRow.sourceType === 'web'
    );
  },
  sortCheckpointTask: sortCheckpointAsc,
  filterCheckpointTask: filterNonChapterCheckpoint,
  getChapters: async ({ resourceHref }) => {
    // NOTE: These pages have no chapters
    return [
      {
        href: resourceHref.href,
        props: {
          chapterNumber: 1,
        },
      },
    ];
  },
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
      ],
    }),
    defineHandler({
      handler: { fn: getPageContentMd },
      stringify: [
        {
          name: 'md',
          fn: (content) => content,
          output: {
            extension: 'md',
            getFileName: defineGetFileNameFunction(getDefaultDocumentPath),
          },
        },
      ],
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
