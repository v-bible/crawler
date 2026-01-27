import { getChapters } from '@/augustino.net/getChapters';
import { getPageContent } from '@/augustino.net/getPageContent';
import { getPageContentMd } from '@/augustino.net/getPageContentMd';
import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { Crawler } from '@/lib/nlp/crawler';
import { getMetadataFromCSV } from '@/lib/nlp/crawlerUtils';

const main = async () => {
  const crawler = new Crawler({
    name: 'augustino.net',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'augustino.net' &&
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
    getChapters,
    getPageContentHandler: {
      inputFn: getPageContent,
    },
    getPageContentMd,
  });

  await crawler.run();
};

main();
