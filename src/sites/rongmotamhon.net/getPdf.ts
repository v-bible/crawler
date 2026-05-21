/* eslint-disable no-await-in-loop */
import retry from 'async-retry';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import { type GetPageExtraContentFunction } from '@/lib/crawler/crawler';
import {
  getDefaultDocumentPath,
  writeChapterContentBuffer,
} from '@/lib/crawler/fileUtils';
import { getLogContext, logError, logInfo } from '@/lib/crawler/logUtils';
import {
  createRongMotamhonBrowserPage,
  gotoWithRetry,
} from '@/sites/rongmotamhon.net/browserUtils';

const getPdf: GetPageExtraContentFunction = async ({
  resourceHref,
  chapterParams,
  metadata,
}) => {
  const { href } = resourceHref;
  const logContext = getLogContext(chapterParams, metadata, href);

  const { browser, context, page } = await createRongMotamhonBrowserPage();

  try {
    await gotoWithRetry(page, href);

    const pdfOptions = [
      { label: 'Càn Long', suffix: 'can-long' },
      { label: 'Vĩnh Lạc', suffix: 'vinh-lac' },
      { label: 'CBETA', suffix: 'cbeta' },
    ] as const;

    const failures: string[] = [];

    await Promise.all(
      pdfOptions.map(async (option) => {
        const link = page.locator('a', { hasText: option.label }).first();

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
                timeout: 5 * 36000,
              });
            },
            {
              retries: 500,
            },
          );

          // NOTE: Monitor the network requests to find the actual PDF file URL

          const pdfRequest = await retry(
            async () => {
              const request = await pdfPage.waitForRequest(
                (req) => req.url().endsWith('.pdf'),
                {
                  timeout: 5 * 36000,
                },
              );
              return request;
            },
            {
              retries: 500,
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
            suffix: option.suffix,
          });

          logInfo(`Writing ${option.suffix} PDF to: ${filePath}`, logContext);

          writeChapterContentBuffer({
            params: chapterParams,
            baseDir: DEFAULT_OUTPUT_FILE_DIR,
            content: pdfBuffer,
            extension: 'pdf',
            documentTitle: metadata?.title,
            getFileName: () => filePath,
          });
        } catch (error) {
          failures.push(`Failed to download ${option.label}`);
          logError(
            `Failed to load PDF page for link ${pdfHref}`,
            logContext,
            error as Error,
          );
          if (!pdfPage.isClosed()) {
            await pdfPage.close();
          }
        }
      }),
    );

    if (failures.length > 0) {
      throw new Error(failures.join('; '));
    }
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPdf };
