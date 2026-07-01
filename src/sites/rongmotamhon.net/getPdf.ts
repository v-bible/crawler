/* eslint-disable no-await-in-loop */
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { retry } from 'es-toolkit';
import { chromium, devices } from 'playwright';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import {
  getDefaultDocumentPath,
  writeChapterContentBuffer,
} from '@/lib/crawler/fileUtils';
import { getLogContext, logError, logInfo } from '@/lib/crawler/logUtils';
import { type Metadata } from '@/lib/crawler/schema';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';

type PdfType = {
  label: string;
  suffix: string;
};

const getPdfBase = (type: PdfType) => {
  return (async ({ resourceHref, chapterParams }, metadata, signal) => {
    const { href } = resourceHref;
    const logContext = getLogContext(chapterParams, metadata, href);

    const browser = await chromium.launch();
    const context = await browser.newContext(devices['Desktop Chrome']);
    const page = await context.newPage();

    try {
      await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then(
        (blocker) => {
          blocker.enableBlockingInPage(page);
        },
      );

      await retry(
        async () => {
          await page.goto(href, {
            waitUntil: 'domcontentloaded',
            timeout: 5 * 36000,
          });
        },
        {
          retries: 5,
          signal,
        },
      );

      const link = page.locator('a', { hasText: type.label }).first();

      if (!(await link.count())) {
        return;
      }

      const pdfHref = await link.getAttribute('href');

      if (!pdfHref) {
        return;
      }

      const pdfPage = await context.newPage();

      try {
        await retry(
          async () => {
            await pdfPage.goto(pdfHref, {
              waitUntil: 'domcontentloaded',
              timeout: 1000 * 60, // 1 minute,
            });
          },
          {
            retries: 500,
            signal,
          },
        );

        // NOTE: Monitor the network requests to find the actual PDF file URL

        const pdfRequest = await retry(
          async () => {
            const request = await pdfPage.waitForRequest(
              (req) => req.url().endsWith('.pdf'),
              {
                timeout: 1000 * 60, // 1 minute,
              },
            );
            return request;
          },
          {
            retries: 500,
            signal,
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
          suffix: type.suffix,
        });

        logInfo(`Writing ${type.suffix} PDF to: ${filePath}`, logContext);

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
        if (!pdfPage.isClosed()) {
          await pdfPage.close();
        }
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }) satisfies WorkerHandlerFn<GetPageContentParams, void, Metadata>;
};

export { getPdfBase };
