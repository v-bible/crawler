/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { type Metadata } from '@/lib/crawler/schema';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';
import {
  cleanupMdProcessor,
  normalizeAsterisk,
  normalizeMd,
  normalizeNumberBullet,
  normalizeQuotes,
  normalizeWhitespace,
  removeMdHr,
  removeMdImgs,
  removeMdLinks,
  removeRedundantSpaces,
} from '@/lib/md/mdUtils';
import { parseMd } from '@/lib/md/remark';
import {
  createRongMotamhonBrowserPage,
  getReadmeContentHtml,
  gotoWithRetry,
} from '@/sites/rongmotamhon.net/browserUtils';

const getPageContentMdVie: WorkerHandlerFn<
  GetPageContentParams,
  string,
  Metadata
> = async ({ resourceHref }) => {
  const { href } = resourceHref;

  const { browser, context, page } = await createRongMotamhonBrowserPage({
    blockAds: true,
  });

  try {
    await gotoWithRetry(page, href);

    const bodyHtml = await getReadmeContentHtml(page);

    if (!bodyHtml.trim()) {
      return '';
    }

    const md = await parseMd(bodyHtml);

    const cleanupMd = cleanupMdProcessor(md, [
      removeMdImgs,
      (str) =>
        removeMdLinks(str, {
          useLinkAsAlt: false,
        }),
      removeMdHr,
      // NOTE: Have to run first so the asterisk regex can match correctly
      normalizeWhitespace,
      normalizeAsterisk,
      normalizeQuotes,
      normalizeNumberBullet,
      normalizeMd,
      removeRedundantSpaces,
    ]);

    return cleanupMd.trim();
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPageContentMdVie };
