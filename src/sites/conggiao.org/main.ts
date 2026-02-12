import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import { Crawler } from '@/lib/crawler/crawler';
import { getMetadataFromCSV } from '@/lib/crawler/crawlerUtils';
import { filterNonChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import { getPageContent } from '@/sites/conggiao.org/getPageContent';
import { getPageContentMd } from '@/sites/conggiao.org/getPageContentMd';

export const crawler = new Crawler({
  name: 'conggiao.org',
  domain: 'R',
  subDomain: 'C',
  getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
  getMetadataBy: (metadataRow) => {
    return (
      metadataRow.source === 'conggiao.org' && metadataRow.sourceType === 'web'
    );
  },
  sortCheckpoint: sortCheckpointAsc,
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
