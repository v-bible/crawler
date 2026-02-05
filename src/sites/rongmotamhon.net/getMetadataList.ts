/* eslint-disable no-await-in-loop */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { chromium, devices } from 'playwright';
import z from 'zod';
import { getDocumentId } from '@/lib/crawler/getId';
import {
  type MetadataInput,
  MetadataOutput,
  MetadataSchema,
} from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

export const getMetadataList = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    blocker.enableBlockingInPage(page);
  });

  // NOTE: We only get Vietnamese translated Buddhist books
  await page.goto(
    'https://www.rongmotamhon.net/kinh-bac-truyen_viet-van_lpks_0.html',
    {
      waitUntil: 'domcontentloaded',
      timeout: 5 * 3600,
    },
  );

  const metadataList: MetadataOutput[] = [];

  let currentPage = 1;
  let documentNumber = 1;

  let nextPageLink;

  while (nextPageLink || currentPage === 1) {
    try {
      const bookLinks = await page
        .locator('div.img-portfolio')
        .locator('a', {
          has: page.locator('strong'),
        })
        .all();

      // Capture the current value of documentNumber to avoid closure issues
      const baseDocumentNumber = documentNumber;

      const bookHrefs = await Promise.all(
        bookLinks.map(async (link, idx) => {
          const currentDocumentNumber = baseDocumentNumber + idx;
          const href = await link.getAttribute('href');
          if (!href) {
            return [];
          }

          const title =
            (await link.locator('strong').textContent())?.trim() || '';

          const metadata = {
            documentNumber: currentDocumentNumber,
            documentId: getDocumentId({
              documentNumber: currentDocumentNumber,
              domain: 'R',
              subDomain: 'B',
              genre: 'Z',
            }),
            title,
            sourceType: 'web',
            sourceURL: href,
            language: 'Việt',
            genre: {
              code: 'Z',
              category: 'others',
              vietnamese: 'Khác',
            },
            tags: [],
            // NOTE: Set this to trigger chapter fetching
            hasChapters: true,
          } satisfies MetadataInput;

          const parsedMetadata = MetadataSchema.safeParse(metadata);

          if (!parsedMetadata.success) {
            logger.error(
              `Invalid metadata parsed from rongmotamhon.net: ${JSON.stringify(metadata)}. Errors: ${z.treeifyError(
                parsedMetadata.error,
              )}`,
            );
            return [];
          }

          logger.info(`Fetched: ${title} - ${href}`);

          return [parsedMetadata.data];
        }),
      );

      documentNumber += bookLinks.length;

      metadataList.push(...bookHrefs.flat());

      nextPageLink = await page
        .locator('h1.page-header + div')
        .locator('a')
        .filter({ hasText: ` » Trang ${currentPage + 1} » ` })
        .first()
        .getAttribute('href');

      if (nextPageLink) {
        await page.goto(nextPageLink, {
          timeout: 5 * 3600,
          waitUntil: 'domcontentloaded',
        });

        currentPage += 1;
      }
    } catch (error) {
      break;
    }
  }

  await context.close();
  await browser.close();

  return metadataList;
};
