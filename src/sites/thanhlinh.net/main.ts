import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import {
  Crawler,
  defaultSortCheckpoint,
  filterNonChapterCheckpoint,
} from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { getPageContent } from '@/sites/thanhlinh.net/getPageContent';
import { getPageContentMd } from '@/sites/thanhlinh.net/getPageContentMd';

export const crawler = new Crawler({
  name: 'thanhlinh.net',
  domain: 'R',
  subDomain: 'C',
  getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
  getMetadataBy: (metadataRow) => {
    return (
      metadataRow.source === 'thanhlinh.net' && metadataRow.sourceType === 'web'
    );
  },
  sortCheckpoint: defaultSortCheckpoint,
  filterCheckpoint: filterNonChapterCheckpoint,
  getChapters: ({ resourceHref }) => {
    return new Bluebird.Promise((resolve) => {
      // NOTE: These pages have no chapters
      resolve([
        {
          href: resourceHref.href,
          props: {
            chapterNumber: 1,
          },
        },
      ]);
    });
  },
  getPageContentHandler: {
    inputFn: getPageContent,
  },
  getPageContentMd,
});

const main = async () => {
  await crawler.run();
};

// Run directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
