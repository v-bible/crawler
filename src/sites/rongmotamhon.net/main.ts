import { Crawler } from '@/lib/crawler/crawler';
import { getDefaultDocumentPath } from '@/lib/crawler/fileUtils';
import { filterChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { generateCsvTree } from '@/lib/crawler/treeUtils';
import { getChapters } from '@/sites/rongmotamhon.net/getChapters';
import { getMetadataList } from '@/sites/rongmotamhon.net/getMetadataList';
import { getPageContent } from '@/sites/rongmotamhon.net/getPageContent';
import { getPageContentVie } from '@/sites/rongmotamhon.net/getPageContentVie';
import { getPdf } from '@/sites/rongmotamhon.net/getPdf';

export const crawler = new Crawler({
  name: 'rongmotamhon.net',
  domain: 'R',
  subDomain: 'B',
  getMetadataList,
  sortCheckpoint: sortCheckpointAsc,
  filterCheckpoint: filterChapterCheckpoint,
  getChapters,
  getPageContentHandler: [
    {
      inputFn: getPageContent,
      stringifyFn: generateCsvTree,
      extraContentFn: [getPdf],
    },
    {
      inputFn: getPageContentVie,
      getFileName: (params) =>
        getDefaultDocumentPath({
          ...params,
          suffix: 'vie',
        }),
      stringifyFn: generateCsvTree,
    },
  ],
});

const main = async () => {
  await crawler.run();
};

// Run directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
