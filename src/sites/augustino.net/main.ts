import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import { Crawler } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { filterNonChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { getChapters } from '@/sites/augustino.net/getChapters';
import { getPageContent } from '@/sites/augustino.net/getPageContent';
import { getPageContentMd } from '@/sites/augustino.net/getPageContentMd';

export const crawler = new Crawler({
  name: 'augustino.net',
  domain: 'R',
  subDomain: 'C',
  getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
  getMetadataBy: (metadataRow) => {
    return (
      metadataRow.source === 'augustino.net' && metadataRow.sourceType === 'web'
    );
  },
  sortCheckpoint: sortCheckpointAsc,
  filterCheckpoint: filterNonChapterCheckpoint,
  getChapters,
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
