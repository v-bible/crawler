import { Crawler } from '@/lib/nlp/crawler';
import { getDefaultDocumentPath } from '@/lib/nlp/fileUtils';
import { getChapters } from '@/rongmotamhon.net/getChapters';
import { getMetadataList } from '@/rongmotamhon.net/getMetadataList';
import { getPageContent } from '@/rongmotamhon.net/getPageContent';
import { getPageContentVie } from '@/rongmotamhon.net/getPageContentVie';

const main = async () => {
  const crawler = new Crawler({
    name: 'rongmotamhon.net',
    domain: 'R',
    subDomain: 'B',
    getMetadataList,
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
    getPageContentHandler: [
      {
        inputFn: getPageContent,
      },
      {
        inputFn: getPageContentVie,
        getFileName: (params) =>
          getDefaultDocumentPath({
            ...params,
            suffix: 'vie',
          }),
      },
    ],
  });

  await crawler.run();
};

main();
