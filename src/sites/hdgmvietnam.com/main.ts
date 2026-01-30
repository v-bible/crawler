import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import {
  Crawler,
  defaultSortCheckpoint,
  filterNonChapterCheckpoint,
} from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { getPageContent } from '@/sites/hdgmvietnam.com/getPageContent';
import { getPageContentMd } from '@/sites/hdgmvietnam.com/getPageContentMd';

const main = async () => {
  const crawler = new Crawler({
    name: 'hdgmvietnam.com',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'hdgmvietnam.com' &&
        metadataRow.sourceType === 'web'
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
