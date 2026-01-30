/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import retry from 'async-retry';
import { format, parse } from 'date-fns';
import { uniqBy } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import z from 'zod';
import { getDocumentId } from '@/lib/crawler/getId';
import { MetadataInput, MetadataSchema } from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

const postSection = [
  'https://dongten.net/category/hoi-dap-cong-giao/',
  'https://dongten.net/category/muc-khac/ban-doc-viet/',
  'https://dongten.net/category/chuyen-de/hoc-hoi-phuc-am/',
  'https://dongten.net/loi-chua-hang-ngay/',
  'https://dongten.net/category/loan-bao-tin-mung/',
  'https://dongten.net/tong-do-cau-nguyen/',
  'https://dongten.net/category/phuc-vu-duc-tin/',
  'https://dongten.net/category/hoc-lam-nguoi/',
  'https://dongten.net/category/suy-tu-2/',
  'https://dongten.net/category/cau-nguyen/',
  'https://dongten.net/category/cac-thanh/',
  'https://dongten.net/category/tri-thuc/kinh-thanh/',
  'https://dongten.net/category/tri-thuc/than/',
  'https://dongten.net/category/tri-thuc/triet/',
  'https://dongten.net/category/tri-thuc/luan-ly/',
];

const getPostPageNumber = async (link: string) => {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  logger.info(`Fetching page number for link: ${link}`);

  await retry(
    async () => {
      await page.goto(link, {
        timeout: 36000, // In milliseconds is 36 seconds
      });
    },
    {
      retries: 5,
    },
  );

  const isVisible = (await page.locator('div.pagination').count()) > 0;

  if (!isVisible) {
    logger.warn(`Pagination not found for link: ${link}`);
    await context.close();
    await browser.close();
    return 1;
  }

  const lastPage = await page
    .locator('div.pagination')
    .locator('a')
    .last()
    .getAttribute('href');

  await context.close();
  await browser.close();

  if (!lastPage) {
    return 1;
  }

  const pageNumber = Number(lastPage.split('/').at(-2));

  return pageNumber;
};

export const getMetadataList = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  let currentDocumentNumber = 1;
  const metadataList: MetadataInput[] = [];

  for await (const link of postSection) {
    const pageNumber = await getPostPageNumber(link);

    for (let i = 0; i <= pageNumber; i += 1) {
      const pageLink = `${link}/page/${i}`;

      await retry(
        async () => {
          await page.goto(pageLink, {
            timeout: 36000, // In milliseconds is 36 seconds
          });
        },
        {
          retries: 5,
        },
      );

      const articles = await page.locator('article[class="item-list"]').all();

      for await (const item of articles) {
        const title = (await item.locator('h2').textContent())?.trim();
        const href = (
          await item.locator('h2').locator('a').getAttribute('href')
        )?.trim();

        if (!href) {
          logger.warn(`No link found for article with title: ${title}`);
          // eslint-disable-next-line no-continue
          continue;
        }

        let fmtDate = null;

        const publishDateStr = await item
          .locator('span[class="tie-date"]')
          .textContent();

        if (publishDateStr) {
          try {
            const publishedDate = parse(
              publishDateStr,
              'd MMMM, y',
              new Date(),
            );

            fmtDate = format(publishedDate, 'dd/MM/yyyy');
          } catch (error) {
            logger.error(
              `Error parsing date "${publishDateStr}" for article with title: ${title}. Error: ${error}`,
            );
          }
        }

        const metadata = {
          documentNumber: currentDocumentNumber,
          documentId: getDocumentId({
            documentNumber: currentDocumentNumber,
            domain: 'R',
            subDomain: 'C',
            genre: 'Z',
          }),
          title: title || '',
          sourceType: 'web',
          sourceURL: href,
          language: 'Việt',
          period: '21',
          publishedTime: fmtDate || '',
          genre: {
            code: 'Z',
            category: 'others',
            vietnamese: 'Khác',
          },
          tags: [],
        } satisfies MetadataInput;

        const parsedMetadata = MetadataSchema.safeParse(metadata);

        if (!parsedMetadata.success) {
          logger.error(
            `Invalid metadata parsed: ${JSON.stringify(
              metadata,
            )}. Errors: ${z.treeifyError(parsedMetadata.error)}`,
          );

          // eslint-disable-next-line no-continue
          continue;
        }

        logger.info(`Fetched: ${title} - ${href}`);

        currentDocumentNumber += 1;

        metadataList.push(parsedMetadata.data);
      }
    }
  }

  await context.close();
  await browser.close();

  return uniqBy(metadataList, (item) => item.sourceURL);
};
