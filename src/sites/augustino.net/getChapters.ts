import retry from 'async-retry';
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

      await retry(
        async () => {
          await page.goto(href);
        },
        {
          retries: 5,
        },
      );

      const toc = page.locator('div[class*="tree-toc"]');
      const tocLinks = await toc.getByRole('link').all();

      const links = (
        await Promise.all(
          tocLinks.map(async (linkEl, idx) => {
            const chapterHref = `https://augustino.net/${await linkEl.getAttribute('href')}`;
            const text = (await linkEl.textContent()) || '';

            if (!chapterHref) {
              logger.warn('Chapter link is missing', {
                href,
              });

              return [];
            }

            return [
              {
                href: chapterHref,
                props: {
                  chapterNumber: idx + 1,
                  chapterName: text,
                },
              } satisfies Awaited<ReturnType<GetChaptersFunction>>[number],
            ];
          }),
        )
      ).flat();

      await context.close();
      await browser.close();

      resolve(links);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetChaptersFunction;

export { getChapters };
