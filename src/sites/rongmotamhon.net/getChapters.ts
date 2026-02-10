/* eslint-disable no-await-in-loop */
import { uniqBy } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetChaptersFunction } from '@/lib/crawler/crawler';
import { logger } from '@/logger/logger';

const getChapters = (({ resourceHref }) => {
  return new Bluebird.Promise(async (resolve, reject, onCancel) => {
    const { href } = resourceHref;

    const browser = await chromium.launch();
    const context = await browser.newContext(devices['Desktop Chrome']);
    const page = await context.newPage();

    try {
      // Set up cancellation handler after resources are created
      onCancel!(async () => {
        await context.close();
        await browser.close();

        reject(new Error('Operation was cancelled'));
      });

      await page.goto(href, {
        timeout: 5 * 3600,
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
          timeout: 5 * 3600,
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

      logger.info(`Fetched ${chapters.length} chapters from rongmotamhon.net`, {
        bookHref: href,
        chapterHref: href,
      });

      resolve(chapters);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetChaptersFunction;

export { getChapters };
