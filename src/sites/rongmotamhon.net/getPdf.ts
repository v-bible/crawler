/* eslint-disable no-await-in-loop */
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import { type GetPageExtraContentFunction } from '@/lib/crawler/crawler';
import {
  getDefaultDocumentPath,
  writeChapterContentBuffer,
} from '@/lib/crawler/fileUtils';
import { getLogContext, logError, logInfo } from '@/lib/crawler/logUtils';

const getPdf: GetPageExtraContentFunction = async ({
  resourceHref,
  chapterParams,
  metadata,
}) => {
  const { href } = resourceHref;
  const logContext = getLogContext(chapterParams, metadata, href);

  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
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

        logInfo(`Writing ${suffix} PDF to: ${filePath}`, logContext);

        writeChapterContentBuffer({
          params: chapterParams,
          baseDir: DEFAULT_OUTPUT_FILE_DIR,
          content: pdfBuffer,
          extension: 'pdf',
          documentTitle: metadata?.title,
          getFileName: () => filePath,
        });
      } catch (error) {
        logError(
          `Failed to load PDF page for link ${pdfHref}`,
          logContext,
          error as Error,
        );
        // Only close page if it's still open
        if (!pdfPage.isClosed()) {
          await pdfPage.close();
        }
        // eslint-disable-next-line no-continue
        continue;
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPdf };
