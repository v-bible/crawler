/* eslint-disable no-restricted-syntax */
import { retry } from 'es-toolkit';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type LogContext, logError } from '@/lib/crawler/logUtils';
import {
  type Metadata,
  type MultiLanguageSentence,
  type Page,
} from '@/lib/crawler/schema';
import { type ChapterTreeOutput } from '@/lib/crawler/treeSchema';
import { pageToChapterTree } from '@/lib/crawler/treeUtils';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';
import {
  createRongMotamhonBrowserPage,
  getReadmeContentHtml,
  gotoWithRetry,
} from '@/sites/rongmotamhon.net/browserUtils';

const fetchHtmlContent = async (url: string) => {
  let group = 0;
  let content = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const newContent = await retry(
      // eslint-disable-next-line no-loop-func
      async () => {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url, {
          headers: {
            referer: encodeURIComponent(url),
          },
          body: new URLSearchParams({
            group_no: group.toString(),
          }),
          method: 'POST',
        });

        const res = await response.text();

        if (!response.ok) {
          throw new Error(`Failed to fetch content for group ${group}`);
        }
        return res;
      },
      {
        retries: 500,
      },
    );
    if (!newContent || newContent.trim() === '') {
      break;
    }

    content += newContent;

    group += 1;
  }

  if (content.trim() === '') {
    throw new Error('Fetched content is empty');
  }

  return content;
};

const getPageContent: WorkerHandlerFn<
  GetPageContentParams,
  ChapterTreeOutput,
  Metadata
> = async ({ resourceHref, chapterParams }, metadata) => {
  const { href } = resourceHref;

  const { browser, context, page } = await createRongMotamhonBrowserPage({
    blockAds: true,
  });

  try {
    await gotoWithRetry(page, href);

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

    let htmlBody = '';

    try {
      await gotoWithRetry(page, chinesePageLink);

      // NOTE: Get resource URL to pass to fetchHtmlContent to avoid issues with
      // referer when fetching from node
      const resourceRequest = await page.waitForRequest((request) =>
        request.url().includes('includes/autoload_process2.php'),
      );

      const resourceUrl = resourceRequest.url();

      if (!resourceUrl) {
        const errorContext: LogContext = {
          resourceHref: href,
        };
        logError('Resource URL not found from page requests', errorContext);
        throw new Error('Resource URL not found from page requests');
      }

      htmlBody = await fetchHtmlContent(resourceUrl);
    } catch (error) {
      const errorContext: LogContext = chapterParams;
      logError('Failed to fetch HTML content', errorContext, error);
      throw error;
    }

    const baseHtmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`;

    await page.setContent(baseHtmlBody, {
      waitUntil: 'domcontentloaded',
    });

    const readmeContentHtml = await getReadmeContentHtml(page);

    if (!readmeContentHtml.trim()) {
      throw new Error('Chinese content body not found');
    }

    // Bulk scrape all character data at once using page.evaluate
    const charactersData = await page.evaluate((contentHtml) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = contentHtml;

      const links = Array.from(wrapper.querySelectorAll('a'));

      return links
        .map((link, index, array) => {
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
          const isEndOfSentence =
            nextSibling?.nodeName === 'BR' || index === array.length - 1;

          return {
            chineseVietnameseCharacter: chineseVietnameseCharacter.trim(),
            chineseCharacter,
            punctuation,
            isEndOfSentence,
            index,
          };
        })
        .filter((item) => item.chineseCharacter !== ''); // Filter out any items that are completely empty
    }, readmeContentHtml);

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

    const pageData = [
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
    ] satisfies Page[];

    return pageToChapterTree(pageData, chapterParams, metadata);
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPageContent };
