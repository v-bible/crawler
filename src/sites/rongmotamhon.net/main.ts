import {
  Crawler,
  defaultSortCheckpoint,
  filterNonChapterCheckpoint,
} from '@/lib/crawler/crawler';
import { getDefaultDocumentPath } from '@/lib/crawler/fileUtils';
import { getChapters } from '@/sites/rongmotamhon.net/getChapters';
import { getMetadataList } from '@/sites/rongmotamhon.net/getMetadataList';
import { getPageContent } from '@/sites/rongmotamhon.net/getPageContent';
import { getPageContentVie } from '@/sites/rongmotamhon.net/getPageContentVie';

export const crawler = new Crawler({
  name: 'rongmotamhon.net',
  domain: 'R',
  subDomain: 'B',
  getMetadataList,
  sortCheckpoint: defaultSortCheckpoint,
  filterCheckpoint: filterNonChapterCheckpoint,
  getChapters,
  getPageContentHandler: [
    {
      inputFn: getPageContent,
    },
    {
      inputFn: getPageContentVie,
      getFileName: (params) =>
        getDefaultDocumentPath({
          ...params,
          suffix: 'vie',
        }),
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
