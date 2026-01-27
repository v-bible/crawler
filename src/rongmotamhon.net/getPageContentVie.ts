/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/nlp/crawler';
import { getPageId, getSentenceId } from '@/lib/nlp/getId';
import { type SingleLanguageSentence } from '@/lib/nlp/schema';

const getPageContentVie = (({ resourceHref, chapterParams }) => {
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
        await page.close();
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

      await bodyLocator.evaluate((el) => {
        // NOTE: Remove first bold element which is the title
        el.querySelector('b')?.firstChild?.remove();
      });

      const bodyContent = await bodyLocator.textContent();

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
      await page.close();
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContentVie };
