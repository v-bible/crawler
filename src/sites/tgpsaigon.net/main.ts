import path from 'path';
import { DEFAULT_CHECKPOINT_DIR } from '@/constants';
import { Crawler } from '@/lib/crawler/crawler';
import { getCatechismBook } from '@/sites/tgpsaigon.net/getCatechismBook';
import { getMetadataList } from '@/sites/tgpsaigon.net/getMetadataList';

const CHECKPOINT_FILE_PATH = path.join(
  DEFAULT_CHECKPOINT_DIR,
  'RC-tgpsaigon.net-catechism-checkpoint.json',
);

export const crawler = new Crawler({
  name: 'tgpsaigon.net',
  domain: 'R',
  subDomain: 'C',
  checkpointFilePath: CHECKPOINT_FILE_PATH,
  getMetadataList,
  getMetadataBy: (metadataRow) => {
    return (
      metadataRow.source === 'tgpsaigon.net' && metadataRow.sourceType === 'web'
    );
  },
  getChapters: async ({ resourceHref, documentParams, metadata }) => {
    const gradeNum = documentParams?.documentNumber ?? 1;

    return [
      {
        href: resourceHref.href,
        props: {
          chapterNumber: gradeNum,
          chapterName: metadata?.title ?? `Hiệp thông ${gradeNum}`,
        },
      },
    ];
  },
  getPageContentHandler: {
    extraContentFn: getCatechismBook,
  },
});

const main = async () => {
  await crawler.run();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
