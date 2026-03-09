/* eslint-disable no-await-in-loop */
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import Bluebird from '@/lib/bluebird';
import { type GetPageExtraContentFunction } from '@/lib/crawler/crawler';
import {
  getDefaultDocumentPath,
  writeChapterContentBuffer,
} from '@/lib/crawler/fileUtils';
import { logger } from '@/logger/logger';

const getPdf = (({ resourceHref, chapterParams, metadata }) => {
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
          await page.goto(href, {
            waitUntil: 'domcontentloaded',
            timeout: 5 * 36000,
          });
        },
        {
          retries: 5,
        },
      );

      const pdfLinkLocator = await page
        .locator('a', {
          hasText: 'Càn Long',
        })
        .or(
          page.locator('a', {
            hasText: 'Vĩnh Lạc',
          }),
        )
        .or(
          page.locator('a', {
            hasText: 'CBETA',
          }),
        )
        .all();

      // eslint-disable-next-line no-restricted-syntax
      for await (const link of pdfLinkLocator) {
        const pdfHref = await link.getAttribute('href');

        if (!pdfHref) {
          // eslint-disable-next-line no-continue
          continue;
        }
        let suffix = '';

        if (pdfHref.includes('can-long')) {
          suffix = 'can-long';
        } else if (pdfHref.includes('vinh-lac')) {
          suffix = 'vinh-lac';
        } else if (pdfHref.includes('CBETA')) {
          suffix = 'cbeta';
        }

        const pdfPage = await context.newPage();

        try {
          await retry(
            async () => {
              await pdfPage.goto(pdfHref, {
                waitUntil: 'domcontentloaded',
                timeout: 5 * 36000,
              });
            },
            {
              retries: 5,
            },
          );

          // NOTE: Monitor the network requests to find the actual PDF file URL

          const pdfRequest = await pdfPage.waitForRequest(
            (request) => request.url().endsWith('.pdf'),
            {
              timeout: 5 * 36000,
            },
          );

          const pdfUrl = pdfRequest.url();

          // Close the page since we have the PDF URL
          await pdfPage.close();

          // Download the PDF file content directly using fetch
          const pdfResponse = await fetch(pdfUrl);
          const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

          // Save the PDF buffer to a file
          const filePath = getDefaultDocumentPath({
            ...chapterParams,
            extension: 'pdf',
            documentTitle: metadata?.title,
            suffix,
          });

          logger.info(`Writing ${suffix} PDF to: ${filePath}`);

          writeChapterContentBuffer({
            params: chapterParams,
            baseDir: DEFAULT_OUTPUT_FILE_DIR,
            content: pdfBuffer,
            extension: 'pdf',
            documentTitle: metadata?.title,
            getFileName: () => filePath,
          });
        } catch (error) {
          logger.error(`Failed to load PDF page for link ${pdfHref}: ${error}`);
          await pdfPage.close();
          // Only close page if it's still open
          if (!pdfPage.isClosed()) {
            await pdfPage.close();
          }
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      await context.close();
      await browser.close();
      resolve();
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageExtraContentFunction;

export { getPdf };
