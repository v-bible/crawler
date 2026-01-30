import {
  Crawler,
  defaultSortCheckpoint,
  filterNonChapterCheckpoint,
} from '@/lib/crawler/crawler';
import { getDefaultDocumentPath } from '@/lib/crawler/fileUtils';
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
    sortCheckpoint: defaultSortCheckpoint,
    filterCheckpoint: filterNonChapterCheckpoint,
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
