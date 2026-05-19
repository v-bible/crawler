/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import { type GetPageContentMdFunction } from '@/lib/crawler/crawler';
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

const getPageContentMdVie: GetPageContentMdFunction = async ({
  resourceHref,
}) => {
  const { href } = resourceHref;

  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
    await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then(
      (blocker) => {
        blocker.enableBlockingInPage(page);
      },
    );

    await retry(
      async () => {
        await page.goto(href, {
          waitUntil: 'domcontentloaded',
          timeout: 5 * 36000,
        });
      },
      {
        retries: 5,
      },
    );

    const bodyLocator = page.locator('[id="readme"]');

    if (!(await bodyLocator.count())) {
      return '';
    }

    await bodyLocator.evaluate((el) => {
      // NOTE: Remove first bold element which is the title
      el.querySelector('b')?.firstChild?.remove();
    });

    const bodyHtml = await bodyLocator.innerHTML();

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
