import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import { Crawler, defaultSortCheckpoint } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { getChapters } from '@/sites/ktcgkpv.org/getChapters';
import { getPageContent } from '@/sites/ktcgkpv.org/getPageContent';

const main = async () => {
  const crawler = new Crawler({
    name: 'ktcgkpv.org',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'ktcgkpv.org' && metadataRow.sourceType === 'web'
      );
    },
    sortCheckpoint: defaultSortCheckpoint,
    getChapters,
    getPageContentHandler: {
      inputFn: getPageContent,
    },
    getPageContentMd: ({ resourceHref }) => {
      return new Bluebird.Promise(async (resolve, reject) => {
        if (!resourceHref.props?.mdHref) {
          reject(new Error('MD href is not provided'));
          return;
        }

        const md = await (await fetch(resourceHref.props.mdHref)).text();

        resolve(md);
      });
    },
  });

  await crawler.run();
};

main();
