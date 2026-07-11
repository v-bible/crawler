/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { retry } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import {
  type Metadata,
  type Page,
  type SingleLanguageSentence,
} from '@/lib/crawler/schema';
import { type ChapterTreeOutput } from '@/lib/crawler/treeSchema';
import { pageToChapterTree } from '@/lib/crawler/treeUtils';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';

const getPageContentVie: WorkerHandlerFn<
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
        signal,
      },
    );

    const bodyLocator = page.locator('[id="readme"]');

    if (!(await bodyLocator.count())) {
      throw new Error(`Body element not found for href: ${href}`);
    }

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
            languageCode: 'V',
            id: sentenceId,
            text: line,
          };

          return sentence;
        }) || [];

    const pageData = [
      {
        id: getPageId({ ...chapterParams, pageNumber: 1 }),
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

export { getPageContentVie };
