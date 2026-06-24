import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { Crawler } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { filterNonChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { stringifyJsonTree, stringifyXmlTree } from '@/lib/crawler/treeUtils';
import { defineHandler } from '@/lib/crawler/worker';
import { getChapters } from '@/sites/augustino.net/getChapters';
import { getPageContent } from '@/sites/augustino.net/getPageContent';
import { getPageContentMd } from '@/sites/augustino.net/getPageContentMd';

export const crawler = new Crawler({
  name: 'augustino.net',
  domain: 'R',
  subDomain: 'C',
  getMetadata: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
  filterMetadata: (metadataRow) => {
    return (
      metadataRow.source === 'augustino.net' && metadataRow.sourceType === 'web'
    );
  },
  sortCheckpointTask: sortCheckpointAsc,
  filterCheckpointTask: filterNonChapterCheckpoint,
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
        },
        {
          name: 'xml',
          fn: stringifyXmlTree,
        },
      ],
    }),
    defineHandler({
      handler: { fn: getPageContentMd },
      stringify: [
        {
          name: 'md',
          fn: (content) => ({
            content,
            extension: 'md',
          }),
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
