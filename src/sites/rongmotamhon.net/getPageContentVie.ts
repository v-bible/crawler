/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type SingleLanguageSentence } from '@/lib/crawler/schema';

const getPageContentVie = (({ resourceHref, chapterParams }) => {
  return new Bluebird.Promise(async (resolve, reject, onCancel) => {
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

      // Set up cancellation handler after resources are created
      onCancel!(async () => {
        await context.close();
        await browser.close();

        reject(new Error('Operation was cancelled'));
      });

      await retry(
        async () => {
          await page.goto(href, {
            waitUntil: 'domcontentloaded',
            timeout: 5 * 3600,
          });
        },
        {
          retries: 5,
        },
      );

      const bodyLocator = page.locator('[id="readme"]');

      if (!(await bodyLocator.count())) {
        resolve([]);
      }

      await bodyLocator.evaluate((el) => {
        // NOTE: Remove first bold element which is the title
        el.querySelector('b')?.firstChild?.remove();
      });

      const bodyContent = await bodyLocator.textContent();

      await context.close();
      await browser.close();

      const sentences =
        bodyContent
          ?.split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line, index) => {
            const sentenceId = getSentenceId({
              ...chapterParams,
              pageNumber: 1,
              sentenceNumber: index + 1,
            });

            const sentence: SingleLanguageSentence = {
              type: 'single',
              languageCode: 'V',
              id: sentenceId,
              text: line,
            };

            return sentence;
          }) || [];

      resolve([
        {
          id: getPageId({ ...chapterParams, pageNumber: 1 }),
          number: 1,
          sentences,
        },
      ]);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContentVie };
