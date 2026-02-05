/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type MultiLanguageSentence, type Page } from '@/lib/crawler/schema';

const getPageContent = (({ resourceHref, chapterParams }) => {
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

      const chinesePageLink = page.locator('a', {
        hasText: 'Hán văn',
      });

      const chinesePageHref = `${await chinesePageLink.getAttribute('href')}?full=yes`;

      await page.goto(chinesePageHref, {
        waitUntil: 'domcontentloaded',
        timeout: 5 * 3600,
      });

      // Bulk scrape all character data at once using page.evaluate
      const charactersData = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll('a[data-type="iframe"]'),
        );
        return links.map((link, index) => {
          const chineseVietnameseCharacter =
            link.getAttribute('title')?.trim() || '';
          const span = link.querySelector('span');
          const chineseCharacter = span?.textContent?.trim() || '';
          const nextSibling = link.nextElementSibling;
          const isEndOfSentence = !nextSibling?.getAttribute('href');

          return {
            chineseVietnameseCharacter,
            chineseCharacter,
            isEndOfSentence,
            index,
          };
        });
      });

      await context.close();
      await browser.close();

      // Process the scraped data to build sentences
      const sentences: MultiLanguageSentence[] = [];
      let currentChineseVietnameseSentence: string[] = [];
      let currentChineseSentence: string[] = [];
      let sentenceNumber = 1;

      for (const characterData of charactersData) {
        currentChineseVietnameseSentence.push(
          characterData.chineseVietnameseCharacter,
        );
        currentChineseSentence.push(characterData.chineseCharacter);

        if (characterData.isEndOfSentence) {
          sentences.push({
            type: 'multiple',
            array: [
              {
                languageCode: 'V',
                text: currentChineseVietnameseSentence.join(' ').trim(),
              },
              {
                languageCode: 'CV',
                text: currentChineseSentence.join(' ').trim(),
              },
            ],
            id: getSentenceId({
              ...chapterParams,
              pageNumber: 1,
              sentenceNumber,
            }),
          });

          currentChineseVietnameseSentence = [];
          currentChineseSentence = [];
          sentenceNumber += 1;
        }
      }

      resolve([
        {
          id: getPageId({
            chapterNumber: chapterParams.chapterNumber,
            pageNumber: 1,
            documentNumber: chapterParams.documentNumber,
            domain: chapterParams.domain,
            subDomain: chapterParams.subDomain,
            genre: chapterParams.genre,
          }),
          number: 1,
          sentences,
        },
      ] satisfies Page[]);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContent };
