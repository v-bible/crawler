import { getPageContent } from '@/conggiao.org/getPageContent';
import { getPageContentMd } from '@/conggiao.org/getPageContentMd';
import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import { Crawler } from '@/lib/nlp/crawler';
import { getMetadataFromCSV } from '@/lib/nlp/crawlerUtils';

const main = async () => {
  const crawler = new Crawler({
    name: 'conggiao.org',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'conggiao.org' &&
        metadataRow.sourceType === 'web'
      );
    },
    sortCheckpoint: (a, b) => {
      return (
        Number(a.params.requiresManualCheck === true) -
        Number(b.params.requiresManualCheck === true)
      );
    },
    filterCheckpoint: (checkpoint) => {
      // REVIEW: Currently we get non chapter pages first
      return !checkpoint.completed && !checkpoint.params.hasChapters;
    },
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
