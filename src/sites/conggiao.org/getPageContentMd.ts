/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { retry } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { WorkerHandlerFn } from '@/lib/crawler/worker';
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

const getPageContentMd: WorkerHandlerFn<GetPageContentParams, string> = async ({
  resourceHref,
}) => {
  const { href } = resourceHref;

  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
    await retry(
      async () => {
        await page.goto(href);
      },
      {
        retries: 5,
      },
    );

    const bodyHtml = await page
      .locator('article')
      .locator('div[class*="post_content"]')
      .innerHTML();

    await context.close();
    await browser.close();

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

export { getPageContentMd };
