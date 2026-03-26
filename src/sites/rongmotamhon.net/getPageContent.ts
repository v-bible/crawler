/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { LogContext, logError } from '@/lib/crawler/logUtils';
import { type MultiLanguageSentence, type Page } from '@/lib/crawler/schema';

const fetchHtmlContent = async (url: string) => {
  let group = 0;
  let content = '';

  const html = await retry(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        const errorContext: LogContext = {
          resourceHref: url,
        };
        logError('Failed to fetch content', errorContext);
        throw new Error(`Failed to fetch content, status: ${response.status}`);
      }
      return response.text();
    },
    {
      retries: 5,
    },
  );

  const resourceUrl = html.match(
    /includes\/autoload_process2\.php\?p_id=\d+&cut=\d+/gm,
  )?.[0];

  if (!resourceUrl) {
    const errorContext: LogContext = {
      resourceHref: url,
    };
    logError('Resource URL not found in HTML', errorContext);
    throw new Error('Resource URL not found in HTML');
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`https://rongmotamhon.net/${resourceUrl}`, {
        headers: {
          referer: encodeURIComponent(url),
        },
        body: new URLSearchParams({
          group_no: group.toString(),
        }),
        method: 'POST',
      });
      if (!response.ok) {
        const errorContext: LogContext = {
          resourceHref: url,
        };
        logError('Failed to fetch content', errorContext);
      }
      // eslint-disable-next-line no-await-in-loop
      const newContent = await response.text();
      if (!newContent || newContent.trim() === '') {
        break;
      }

      content += newContent;

      // NOTE: Time gap between requests to avoid overwhelming the server
      // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      const errorContext: LogContext = {
        resourceHref: url,
      };
      logError('Error fetching content', errorContext, error as Error);

      break;
    }

    group += 1;
  }

  return content;
};

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

      const chinesePageLink = await page
        .locator('a', {
          hasText: 'Hán văn',
        })
        .getAttribute('href');

      if (!chinesePageLink) {
        const errorContext: LogContext = {
          resourceHref: href,
        };
        logError('Chinese page link not found', errorContext);
        throw new Error('Chinese page link not found');
      }

      const htmlBody = await fetchHtmlContent(chinesePageLink);

      const baseHtmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`;

      await page.setContent(baseHtmlBody, {
        waitUntil: 'domcontentloaded',
      });

      // Bulk scrape all character data at once using page.evaluate
      const charactersData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
          .map((link, index) => {
            let chineseVietnameseCharacter =
              link.getAttribute('data-am')?.trim() || '';
            const span = link.querySelector('span');
            const chineseCharacter = span?.textContent?.trim() || '';

            // NOTE: If chinese character is empty, it means the link text is
            // Chinese-Vietnamese should be empty too since it's 1-1 mapping. This is to handle cases where the link text is only punctuation or special characters.
            if (chineseCharacter === '') {
              chineseVietnameseCharacter = chineseCharacter;
            }

            // Get all text between this link and the next link
            let { nextSibling } = link;
            let punctuation = '';

            // Collect all text from text nodes until we hit another element
            while (nextSibling && nextSibling.nodeName === 'SPAN') {
              const text = nextSibling.textContent || '';
              // Remove only whitespace, keep all other characters (punctuation, brackets, etc.)
              const trimmedText = text.replace(/\s+/g, '');
              if (trimmedText) {
                punctuation += trimmedText;
              }
              // eslint-disable-next-line prefer-destructuring
              nextSibling = nextSibling.nextSibling;
            }

            // Check if the next element is br
            const { nextElementSibling } = link;
            const isEndOfSentence = nextElementSibling?.nodeName === 'BR';

            return {
              chineseVietnameseCharacter: chineseVietnameseCharacter.trim(),
              chineseCharacter,
              punctuation,
              isEndOfSentence,
              index,
            };
          })
          .filter((item) => item.chineseCharacter !== ''); // Filter out any items that are completely empty
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
                  .replace(/\s+([,;.!?:，。；！？：、《》「」])/g, '$1')
                  .trim(),
              },
              {
                languageCode: 'C',
                // Chinese has no spaces between characters
                text: currentChineseSentence
                  .join('')
                  .replaceAll('No.', '')
                  .trim(),
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

getPageContent({
  resourceHref: {
    href: 'https://rongmotamhon.net/xem-kinh_kinh-bat-tu-thu-y_cgmdlcg_viet1.html',
  },
  chapterParams: {
    domain: 'R',
    subDomain: 'B',
    genre: 'Z',
    documentNumber: 1,
    chapterNumber: 1,
    chapterName: 'Chương 1-2',
  },
});
