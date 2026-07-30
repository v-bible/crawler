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

export interface NormalizationResult {
  CLine: string;
  CVLine: string;
}

export const EXACT_CHAR_MAP: Record<string, string> = {
  '「': '“',
  '」': '”',
  '『': '‘',
  '』': '’',
  '《': '(',
  '》': ')',
  '〈': '(',
  '〉': ')',
  '【': '[',
  '】': ']',
  '〔': '[',
  '〕': ']',
  '〖': '[',
  '〗': ']',
  '，': ',',
  '；': ';',
  '。': '.',
  '：': ':',
  '？': '?',
  '！': '!',
  '、': ',',
  '…': '...',
  '—': '-',
  '·': '.',
  '～': '~',
  '〜': '~',
};

const RE_CV_PAIR = /\$(.*?)\$\{\{(.*?)\}\}/g;
const RE_CH_ONLY = /\$(.*?)\$\{\{.*?\}\}/g;

/**
 * Cleans up spaces around operators inside Gaiji composition brackets [ ... ]
 * Preserves operators: *, +, -, /, =, (, ), ?, @
 */
export function sanitizeGaijiFormulas(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (_, formula: string) => {
    const cleaned = formula
      .replace(/\s*([*+\-/=()?@])\s*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return `[${cleaned}]`;
  });
}

export function replaceExactChars(text: string): string {
  let result = text;
  for (const [targetChar, replacement] of Object.entries(EXACT_CHAR_MAP)) {
    result = result.split(targetChar).join(replacement);
  }
  return result;
}

export function normalizeSentence(line: string): NormalizationResult {
  const hasCVChar = line.includes('{{') && line.includes('}}');

  // -----------------------------------------------------------------
  // 1. Chinese Line (CLine)
  // -----------------------------------------------------------------
  let CLine = line.replace(RE_CH_ONLY, '$1').replace(/\s+/g, ' ');
  CLine = sanitizeGaijiFormulas(CLine).trim();

  if (!hasCVChar) {
    let fallbackCV = replaceExactChars(line);
    fallbackCV = fallbackCV
      .replace(/\s+/g, ' ')
      .replace(/\s+([,;.!?:”’)\]}])/g, '$1')
      .replace(/([“‘([{])\s+/g, '$1')
      .replace(/([,;.!?:”’)\]}])(?=[\p{L}\p{N}“‘([{])/gu, '$1 ')
      .replace(/([\p{L}\p{N}])(?=[“‘([{])/gu, '$1 ');

    return {
      CLine,
      CVLine: sanitizeGaijiFormulas(fallbackCV).trim(),
    };
  }

  // -----------------------------------------------------------------
  // 2. Sino-Vietnamese Line (CVLine)
  // -----------------------------------------------------------------
  let CVLine = line.replace(RE_CV_PAIR, '$2 ');
  CVLine = replaceExactChars(CVLine);

  // -----------------------------------------------------------------
  // 3. Typography & Bracket Spacing Cleanup
  // -----------------------------------------------------------------
  CVLine = CVLine.replace(/\s+/g, ' ')
    // Erase space BEFORE standard punctuation and closing elements
    .replace(/\s+([,;.!?:”’])/g, '$1')
    // Erase space BEFORE closing brackets/parentheses ONLY outside Gaiji blocks
    .replace(/(?<!\[[^\]]*)\s+([)\]}])/g, '$1')
    // Erase space AFTER opening quotes/brackets/parentheses
    .replace(/([“‘([{])\s+/g, '$1')
    // Ensure space AFTER punctuation OR closing quotes/brackets IF touching text/opening quotes
    .replace(/([,;.!?:”’)\]}])(?=[\p{L}\p{N}“‘([{])/gu, '$1 ')
    // Ensure space BEFORE opening brackets/parentheses IF preceded by letter/number
    .replace(/([\p{L}\p{N}])(?=[([{])/gu, '$1 ')
    // Clean redundant quotes
    .replace(/""+/g, '"')
    .replace(/“\s*”/g, '')
    .replace(/‘\s*’/g, '');

  // Protect Gaiji formula operators inside brackets and force space separation around them
  CVLine = sanitizeGaijiFormulas(CVLine);

  // Enforce spacing between adjacent brackets/parentheses and surrounding letters
  CVLine = CVLine.replace(/([)\]])([\p{L}\p{N}])/gu, '$1 $2')
    .replace(/([\p{L}\p{N}])([[(])/gu, '$1 $2')
    .replace(/([)\]])([[(])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  return { CLine, CVLine };
}

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

        // 1. Verify the string actually contains a Chinese character
        const hasChinese = textContent && /[\u4e00-\u9fff]/.test(textContent);

        // 2. Reject the string if it contains ANY Gaiji math or structural operators.
        // We include brackets [ ] here to prevent wrapping entire grouped formulas.
        const hasGaijiOperators =
          textContent && /[*+\-/=()?[\]@]/.test(textContent);

        // Only inject the phonetic tag if it's a pure character/word without operators
        if (dataAm && hasChinese && !hasGaijiOperators) {
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
        .filter((line) => line !== '')
        .map((line, index) => {
          const { CLine, CVLine } = normalizeSentence(line);

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
