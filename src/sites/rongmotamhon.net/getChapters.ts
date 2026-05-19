/* eslint-disable no-await-in-loop */
import { uniqBy } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import { type GetChaptersFunction } from '@/lib/crawler/crawler';
import { type LogContext, logError, logInfo } from '@/lib/crawler/logUtils';

const getChapters: GetChaptersFunction = async ({ resourceHref }) => {
  const { href } = resourceHref;

  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
    await page.goto(href, {
      timeout: 5 * 36000,
      waitUntil: 'domcontentloaded',
    });

    const chapterLinks = [href];

    let nextBookLink: string | null = resourceHref.href;

    while (nextBookLink) {
      const nextBookLinkLocator = await page.locator('h2 ~ a').all();

      const isNextBookLinkVisible = nextBookLinkLocator.length > 0;

      if (!isNextBookLinkVisible) {
        break;
      }

      const allLinks = (
        await Promise.all(
          nextBookLinkLocator.map(async (locator) => {
            return locator.getAttribute('href');
          }),
        )
      ).filter(Boolean) as string[];

      // NOTE: Check before pushing to avoid infinite loop
      nextBookLink = allLinks.at(-1) || null;

      if (!nextBookLink || chapterLinks.includes(nextBookLink)) {
        break;
      }

      chapterLinks.push(...allLinks);

      await page.goto(nextBookLink, {
        timeout: 5 * 36000,
        waitUntil: 'domcontentloaded',
      });
    }

    await context.close();
    await browser.close();

    const chapters = uniqBy(chapterLinks, (link) => link.split('_').at(-2))
      .filter((link) => !link.includes('none') || !link.includes('dichgia'))
      .map((link, index) => ({
        href: link,
        props: {
          chapterNumber: index + 1,
          chapterName: `Quyển ${index + 1}`,
          mdHref: undefined,
        },
      }));

    const chaptersContext: LogContext = {
      resourceHref: href,
    };
    logInfo(
      `Fetched ${chapters.length} chapters from rongmotamhon.net`,
      chaptersContext,
    );

    return chapters;
  } catch (error) {
    const errorContext: LogContext = {
      resourceHref: href,
    };
    logError(
      'Failed to fetch chapters from rongmotamhon.net',
      errorContext,
      error as Error,
    );
    // Clean up resources on error
    await context.close();
    await browser.close();

    throw error;
  }
};

export { getChapters };
