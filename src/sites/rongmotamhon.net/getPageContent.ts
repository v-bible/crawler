/* eslint-disable no-restricted-syntax */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { retry } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type LogContext, logError } from '@/lib/crawler/logUtils';
import { type Metadata, type Page } from '@/lib/crawler/schema';
import { type ChapterTreeOutput } from '@/lib/crawler/treeSchema';
import { pageToChapterTree } from '@/lib/crawler/treeUtils';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';

const fetchHtmlContent = async (url: string, signal?: AbortSignal) => {
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
        delay: 500,
        retries: 500,
        shouldRetry: () => {
          signal?.throwIfAborted();
          return true;
        },
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
> = async ({ resourceHref, chapterParams }, metadata, signal) => {
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
        shouldRetry: () => {
          signal?.throwIfAborted();
          return true;
        },
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

    let htmlBody = '';

    try {
      await retry(
        async () => {
          await page.goto(chinesePageLink, {
            waitUntil: 'domcontentloaded',
            timeout: 5 * 36000,
          });
        },
        {
          retries: 5,
          signal,
        },
      );

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

      htmlBody = await fetchHtmlContent(resourceUrl, signal);
    } catch (error) {
      const errorContext: LogContext = chapterParams;
      logError('Failed to fetch HTML content', errorContext, error);
      throw error;
    }

    const baseHtmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlBody}</body></html>`;

    await page.setContent(baseHtmlBody, {
      waitUntil: 'domcontentloaded',
    });

    await page.evaluate(() => {
      document.querySelectorAll('br').forEach((br) => {
        br.textContent = '\n';
      });

      document.querySelectorAll('a').forEach((a) => {
        const dataAm = a.getAttribute('data-am');
        const textContent = a.textContent?.trim();
        const isChineseCharacter =
          textContent && /[\u4e00-\u9fff]/.test(textContent);
        if (dataAm && isChineseCharacter) {
          a.textContent = `$${a.textContent}\${{${dataAm}}}`;
        }
      });
    });

    const bodyContent = await page.locator('body').textContent();

    const sentences =
      bodyContent
        ?.split('\n')
        .map((line) =>
          line.replaceAll(/^.*║/gm, '').replaceAll(/No.*/gm, '').trim(),
        )
        .filter((line) => line.trim() !== '')
        .map((line, index) => {
          const hasCVChar = line.includes('{{') && line.includes('}}');

          let CVLine = line
            .replaceAll(/(\$.*?\$)(\{\{(.*?)\}\})/g, '$3 ')
            // NOTE: Remove extra spaces between words and trim leading/trailing
            // spaces
            .replaceAll(/\s+/g, ' ');
          const CLine = line
            .replaceAll(/\$(.*?)\$\{\{.*?\}\}/g, '$1')
            // NOTE: Remove extra spaces between words and trim leading/trailing
            // spaces
            .replaceAll(/\s+/g, ' ')
            .trim();

          if (hasCVChar) {
            CVLine = CVLine
              // NOTE: Remove spaces before punctuation marks
              .replaceAll(/\s+([,;.!?:，。；！？：、])/g, '$1')
              // NOTE: Add spaces after punctuation marks
              .replaceAll(/([,;.!?:，。；！？：、])\s*/g, '$1 ')
              // NOTE: Remove spaces after opening brackets and before closing
              // common brackets
              .replaceAll(/([([{《「])\s*/g, '$1')
              .replaceAll(/\s*([)\]}》」])/g, '$1')
              // NOTE: Add space after closing brackets
              .replaceAll(/([)\]}》」])\s*/g, '$1 ')
              // NOTE: Remove spaces before special asterisks
              .replaceAll(/\s*\*\s*/g, '*')
              // NOTE: Add space between closing and opening brackets if they are
              // adjacent (e.g., ")(" should become ") (")
              .replaceAll(
                /[)\]}》」][([{《「]/g,
                (match) => `${match[0]} ${match[1]}`,
              )
              // NOTE: Normalize common chinese punctuation to their Vietnamese equivalents
              .replaceAll(/，/g, ',')
              .replaceAll(/。/g, '.')
              .replaceAll(/；/g, ';')
              .replaceAll(/！/g, '!')
              .replaceAll(/？/g, '?')
              .replaceAll(/：/g, ':')
              .trim();
          }

          return {
            sentenceNumber: index + 1,
            array: [
              {
                languageCode: 'CV' as const,
                text: CVLine,
              },
              {
                languageCode: 'C' as const,
                text: CLine,
              },
            ],
          };
        }) || [];

    const mappedSentences = sentences.map(
      (sentence, index) =>
        ({
          type: 'multiple',
          array: sentence.array,
          id: getSentenceId({
            ...chapterParams,
            pageNumber: 1,
            sentenceNumber: index + 1,
          }),
        }) as const,
    );

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
        sentences: mappedSentences,
      },
    ] satisfies Page[];

    return pageToChapterTree(pageData, chapterParams, metadata);
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPageContent };
