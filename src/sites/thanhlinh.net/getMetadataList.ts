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
  'https://thanhlinh.net/vi/me-maria/bai-viet-ve-me',
  'https://thanhlinh.net/vi/me-maria/tai-lieu-ve-me-maria',
  'https://thanhlinh.net/vi/me-maria/duc-me-medu',
  'https://thanhlinh.net/vi/me-maria/duc-me-ho-lua',
  'https://thanhlinh.net/vi/me-maria/duc-me-akita',
  'https://thanhlinh.net/vi/me-maria/duc-me-fatima',
  'https://thanhlinh.net/vi/phung-vu/mua-vong',
  'https://thanhlinh.net/vi/phung-vu/mua-giang-sinh',
  'https://thanhlinh.net/vi/phung-vu/mua-phuc-sinh',
  'https://thanhlinh.net/vi/phung-vu/le-lon',
  'https://thanhlinh.net/vi/phung-vu/nam-thanh',
  'https://thanhlinh.net/vi/phung-vu/tong-hop',
  'https://thanhlinh.net/vi/phung-vu/mua-chay-tuan-thanh',
  'https://thanhlinh.net/vi/phung-vu/mua-thuong-nien',
  'https://thanhlinh.net/vi/cau-nguyen/kinh-nguyen-tieng-viet',
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

  const isVisible = (await page.locator('ul[class*="pagination"]').count()) > 0;

  if (!isVisible) {
    logger.warn(`Pagination not found for link: ${link}`);
    await context.close();
    await browser.close();
    return 0;
  }

  const lastPage = await page
    .locator('ul[class*="pagination"]')
    .locator('a')
    .last()
    .getAttribute('href');

  await context.close();
  await browser.close();

  if (!lastPage) {
    return 0;
  }

  const pageNumber = Number(lastPage.split('=').at(1));

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
      const pageLink = `${link}?page=${i}`;

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

      const articles = await page
        .locator('ul[class="vertical-news"]')
        .locator('li')
        .all();

      for await (const item of articles) {
        const title = (await item.locator('a').textContent())?.trim();
        const href = (await item.locator('a').getAttribute('href'))?.trim();

        const newLink = `https://thanhlinh.net${href}`;

        const newPage = await context.newPage();

        await retry(
          async () => {
            await newPage.goto(newLink, {
              timeout: 36000, // In milliseconds is 36 seconds
            });
          },
          {
            retries: 10,
          },
        );

        const date = (
          await newPage
            .locator('div[class="article-inner"]')
            .locator('ul')
            .locator('li')
            .nth(0)
            .textContent()
        )?.trim();
        const publisher = (
          await newPage
            .locator('div[class="article-inner"]')
            .locator('ul')
            .locator('li')
            .nth(1)
            .textContent()
        )?.trim();

        await newPage.close();

        const publishDate = date
          ? parse(date.slice(4, 14), 'dd/MM/yyyy', new Date())
          : new Date();

        const fmtDate = format(publishDate, 'dd/MM/yyyy');

        const metadata = {
          documentNumber: currentDocumentNumber,
          documentId: getDocumentId({
            documentNumber: currentDocumentNumber,
            domain: 'R',
            subDomain: 'C',
            genre: 'Z',
          }),
          title: title || '',
          author: publisher || '',
          sourceType: 'web',
          sourceURL: newLink,
          language: 'Việt',
          period: '21',
          publishedTime: fmtDate,
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

        logger.info(`Fetched: ${title} - ${newLink}`);

        currentDocumentNumber += 1;

        metadataList.push(parsedMetadata.data);
      }
    }
  }

  await context.close();
  await browser.close();

  return uniqBy(metadataList, (item) => item.sourceURL);
};
