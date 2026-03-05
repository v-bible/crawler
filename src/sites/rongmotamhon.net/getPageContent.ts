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
            timeout: 5 * 36000,
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
        timeout: 5 * 36000,
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

          // Get all text between this link and the next link
          let { nextSibling } = link;
          let punctuation = '';

          // Collect all text from text nodes until we hit another element
          while (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
            const text = nextSibling.textContent || '';
            // Remove only whitespace, keep all other characters (punctuation, brackets, etc.)
            const trimmedText = text.replace(/\s+/g, '');
            if (trimmedText) {
              punctuation += trimmedText;
            }
            // eslint-disable-next-line prefer-destructuring
            nextSibling = nextSibling.nextSibling;
          }

          // Check if the next element is not a link (end of sentence)
          const { nextElementSibling } = link;
          const isEndOfSentence = !nextElementSibling?.getAttribute('href');

          return {
            chineseVietnameseCharacter,
            chineseCharacter,
            punctuation,
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

        // Add punctuation if present (same for both languages since it's 1-1 translation)
        if (characterData.punctuation) {
          currentChineseVietnameseSentence.push(characterData.punctuation);
          currentChineseSentence.push(characterData.punctuation);
        }

        if (characterData.isEndOfSentence) {
          sentences.push({
            type: 'multiple',
            array: [
              {
                languageCode: 'CV',
                // Chinese-Vietnamese needs spaces between syllables, but not before punctuation
                text: currentChineseVietnameseSentence
                  .join(' ')
                  .replace(/\s+([,;.!?:，。；！？：、《》「」])/g, '$1'),
              },
              {
                languageCode: 'C',
                // Chinese has no spaces between characters
                text: currentChineseSentence.join(''),
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
