import path from 'path';
import { DEFAULT_CHECKPOINT_DIR } from '@/constants';
import {
  Crawler,
  type GetPageContentHandler,
  type GetPageContentMdHandler,
} from '@/lib/crawler/crawler';
import {
  type GetDefaultDocumentPathFunction,
  getDefaultDocumentPath,
} from '@/lib/crawler/fileUtils';
import { filterChapterCheckpoint } from '@/lib/crawler/filterUtils';
import { sortCheckpointAsc } from '@/lib/crawler/sortUtils';
import {
  generateCsvTree,
  generateJsonTree,
  generateXmlTree,
} from '@/lib/crawler/treeUtils';
import { getChapters } from '@/sites/rongmotamhon.net/getChapters';
import { getMetadataList } from '@/sites/rongmotamhon.net/getMetadataList';
import { getPageContent } from '@/sites/rongmotamhon.net/getPageContent';
import { getPageContentMdVie } from '@/sites/rongmotamhon.net/getPageContentMdVie';
import { getPageContentVie } from '@/sites/rongmotamhon.net/getPageContentVie';
import { getPdf } from '@/sites/rongmotamhon.net/getPdf';

const SHARED_CHECKPOINT_PATH = path.join(
  DEFAULT_CHECKPOINT_DIR,
  'RB-rongmotamhon.net-checkpoint.json',
);

const LOG_FILE_PATH = 'scraping.log';

const getPageContentHandlers = [
  {
    inputFn: getPageContent,
    stringifyFn: [generateCsvTree, generateXmlTree, generateJsonTree],
    extraContentFn: [getPdf],
  },
  {
    inputFn: getPageContentVie,
    getFileName: ((params) =>
      getDefaultDocumentPath({
        ...params,
        suffix: 'vie',
      })) as GetDefaultDocumentPathFunction,
    stringifyFn: [generateCsvTree, generateXmlTree, generateJsonTree],
  },
] satisfies GetPageContentHandler[];

const getPageContentMdHandlers = [
  {
    inputFn: getPageContentMdVie,
    getFileName: ((params) =>
      getDefaultDocumentPath({
        ...params,
        suffix: 'vie',
      })) as GetDefaultDocumentPathFunction,
  },
] satisfies GetPageContentMdHandler[];

export const crawler = new Crawler({
  name: 'rongmotamhon.net - Asc',
  domain: 'R',
  subDomain: 'B',
  checkpointFilePath: SHARED_CHECKPOINT_PATH,
  logFilePath: LOG_FILE_PATH,
  getMetadataList,
  sortCheckpoint: sortCheckpointAsc,
  filterCheckpoint: filterChapterCheckpoint,
  getChapters,
  getPageContentHandler: getPageContentHandlers,
  getPageContentMdHandler: getPageContentMdHandlers,
  crawlerCount: 10,
});

const main = async () => {
  await crawler.run();
};

// Run directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
