/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
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

const getPageContentDailyMd = (({ resourceHref }) => {
  return new Bluebird.Promise(async (resolve, reject, onCancel) => {
    const { href } = resourceHref;

    const browser = await chromium.launch();
    const context = await browser.newContext(devices['Desktop Chrome']);
    const page = await context.newPage();

    try {
      // Set up cancellation handler after resources are created
      onCancel!(async () => {
        await context.close();
        await browser.close();

        reject(new Error('Operation was cancelled'));
      });

      await retry(
        async () => {
          await page.goto(href);
        },
        {
          retries: 5,
        },
      );

      const bodyLocator = page.locator('div.reading-blocks');

      const bodyHtml = await bodyLocator.innerHTML();

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
        (str) => {
          // NOTE: Some pages has a list number which has multiple newlines, so we
          // have to remove newlines before the list number
          return str.replaceAll(/^(\d+)\n\n/gm, (subStr, ...props) => {
            const listNumber = props[0];
            return `${listNumber} `;
          });
        },
      ]);

      resolve(cleanupMd.trim());
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentMdFunction;

export { getPageContentDailyMd };
