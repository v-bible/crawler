import { Crawler } from '@/lib/crawler/crawler';
import { defineHandler } from '@/lib/crawler/worker';
import { getCatechismBook } from '@/sites/tgpsaigon.net/getCatechismBook';
import { getMetadataList } from '@/sites/tgpsaigon.net/getMetadataList';

export const crawler = new Crawler({
  name: 'tgpsaigon.net',
  domain: 'R',
  subDomain: 'C',
  getMetadata: getMetadataList,
  filterMetadata: (metadataRow) => {
    return (
      metadataRow.source === 'tgpsaigon.net' && metadataRow.sourceType === 'web'
    );
  },
  getChapters: async ({ resourceHref, documentParams }, metadata) => {
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
  handlers: [
    defineHandler({
      handler: {
        fn: getCatechismBook,
        // REVIEW: Setup output for manifest checking
      },
    }),
  ],
});

const main = async () => {
  await crawler.run();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
