import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { retry } from 'es-toolkit';
import { type Page, chromium, devices } from 'playwright';

export type RongMotamhonBrowserPage = {
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  context: Awaited<
    ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>
  >;
  page: Page;
};

export async function createRongMotamhonBrowserPage(options?: {
  blockAds?: boolean;
}): Promise<RongMotamhonBrowserPage> {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  if (options?.blockAds) {
    await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then(
      (blocker) => {
        blocker.enableBlockingInPage(page);
      },
    );
  }

  return { browser, context, page };
}

export async function gotoWithRetry(page: Page, url: string): Promise<void> {
  await retry(
    async () => {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 1000 * 60, // 1 minute
      });
    },
    {
      retries: 500,
    },
  );
}

export async function getReadmeContentHtml(page: Page): Promise<string> {
  const readmeLocator = page.locator('[id="readme"]');

  if (!(await readmeLocator.count())) {
    return '';
  }

  return readmeLocator.evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    const separator = clone.querySelector('hr');

    if (!separator) {
      return clone.innerHTML;
    }

    let node = separator.previousSibling;

    while (node) {
      const previousNode = node.previousSibling;
      node.remove();
      node = previousNode;
    }

    separator.remove();

    return clone.innerHTML;
  });
}
