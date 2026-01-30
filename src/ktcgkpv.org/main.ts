import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { getChapters } from '@/ktcgkpv.org/getChapters';
import { getPageContent } from '@/ktcgkpv.org/getPageContent';
import Bluebird from '@/lib/bluebird';
import { Crawler } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';

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
    sortCheckpoint: (a, b) => {
      return (
        Number(a.params.requiresManualCheck === true) -
        Number(b.params.requiresManualCheck === true)
      );
    },
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
