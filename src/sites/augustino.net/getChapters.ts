import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import { type GetChaptersFunction } from '@/lib/crawler/crawler';
import { type LogContext, logWarn } from '@/lib/crawler/logUtils';

const getChapters: GetChaptersFunction = async ({ resourceHref }) => {
  const { href } = resourceHref;

  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();
  try {
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
            const warnContext: LogContext = {
              resourceHref: href,
            };
            logWarn('Chapter link is missing', warnContext);

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

    return links as Awaited<ReturnType<GetChaptersFunction>>;
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getChapters };
