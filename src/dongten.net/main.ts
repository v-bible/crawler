import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { getPageContent } from '@/dongten.net/getPageContent';
import { getPageContentMd } from '@/dongten.net/getPageContentMd';
import Bluebird from '@/lib/bluebird';
import {
  Crawler,
  defaultSortCheckpoint,
  filterNonChapterCheckpoint,
} from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';

const main = async () => {
  const crawler = new Crawler({
    name: 'dongten.net',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'dongten.net' && metadataRow.sourceType === 'web'
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

  await crawler.run();
};

main();
