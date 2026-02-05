/* eslint-disable no-await-in-loop */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import {
  type GetChaptersFunction,
  GetChaptersFunctionHref,
} from '@/lib/crawler/crawler';
import { logger } from '@/logger/logger';

const getChapters = (({ resourceHref }) => {
  return new Bluebird.Promise(async (resolve, reject, onCancel) => {
    const { href } = resourceHref;

    const browser = await chromium.launch();
    const context = await browser.newContext(devices['Desktop Chrome']);
    const page = await context.newPage();

    PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
      blocker.enableBlockingInPage(page);
    });

    try {
      // Set up cancellation handler after resources are created
      onCancel!(async () => {
        await context.close();
        await browser.close();

        reject(new Error('Operation was cancelled'));
      });

      await retry(
        async () => {
          await page.goto(href, {
            timeout: 5 * 3600,
            waitUntil: 'domcontentloaded',
          });
        },
        {
          retries: 5,
        },
      );

      const chapters: Required<GetChaptersFunctionHref>[] = [];

      let currentBook = 1;

      let nextBookLink: string | null = resourceHref.href;

      while (nextBookLink || currentBook === 1) {
        try {
          nextBookLink = await page
            .locator('h2 ~ a', { hasText: `${currentBook + 1}` })
            .first()
            .getAttribute('href');

          if (nextBookLink) {
            chapters.push({
              href: nextBookLink,
              props: {
                chapterNumber: currentBook,
                chapterName: `Quyển ${currentBook}`,
                mdHref: undefined,
              },
            });

            logger.info(
              `Fetched chapter ${currentBook} from rongmotamhon.net`,
              {
                bookHref: href,
                chapterHref: nextBookLink,
              },
            );

            await page.goto(nextBookLink, {
              timeout: 6000,
              waitUntil: 'domcontentloaded',
            });

            currentBook += 1;
          }
        } catch (error) {
          break;
        }
      }

      await context.close();
      await browser.close();

      resolve(chapters);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetChaptersFunction;

export { getChapters };
