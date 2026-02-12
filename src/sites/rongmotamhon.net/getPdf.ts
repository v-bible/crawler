/* eslint-disable no-await-in-loop */
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

      // Helper function to get PDF URL from a link
      const getPdfUrl = async (
        link: string,
        suffix: string,
      ): Promise<{ url: string; suffix: string } | null> => {
        try {
          // First check if the page exists
          const checkResponse = await fetch(link, { method: 'HEAD' });
          if (!checkResponse.ok) {
            logger.info(`${suffix} PDF page not found: ${link}`);
            return null;
          }

          await page.goto(link, {
            timeout: 30000, // 30 seconds timeout
            waitUntil: 'domcontentloaded',
          });

          const iframeSrc = await page
            .locator('iframe')
            .first()
            .getAttribute('src');

          if (!iframeSrc) {
            logger.warn(`No iframe found for ${suffix} at ${link}`);
            return null;
          }

          const parsedIframeSrc = new URL(iframeSrc);
          const fileUrl = parsedIframeSrc.searchParams.get('url');

          if (!fileUrl) {
            logger.warn(`No PDF URL in iframe for ${suffix} at ${link}`);
            return null;
          }

          logger.info(`Found ${suffix} PDF URL: ${fileUrl}`);
          return { url: fileUrl, suffix };
        } catch (error) {
          // Log and return null if page doesn't exist or navigation fails
          logger.warn(`Failed to get PDF URL for ${suffix} at ${link}:`, error);
          return null;
        }
      };

      // Get both PDF links
      const canLongPdfLink = href.replace('_viet1', '_can-long');
      const vinhLacPdfLink = href.replace('_viet1', '_vinh-lac');

      // Get PDF URLs from both links SEQUENTIALLY (not parallel) to avoid page conflicts
      const canLongResult = await getPdfUrl(canLongPdfLink, 'can-long');
      const vinhLacResult = await getPdfUrl(vinhLacPdfLink, 'vinh-lac');

      // Filter out null results
      const availablePdfs = [canLongResult, vinhLacResult].filter(
        (result): result is { url: string; suffix: string } => result !== null,
      );

      if (availablePdfs.length === 0) {
        logger.warn(`No PDF files available for page: ${href}`);
        await context.close();
        await browser.close();
        resolve();
        return;
      }

      // Download available PDFs in parallel
      const downloadResults = await Promise.all(
        availablePdfs.map(async ({ url, suffix }) => {
          try {
            const res = await fetch(url);
            if (!res.ok) {
              logger.error(`Failed to fetch ${suffix} PDF: ${res.statusText}`);
              return null;
            }
            return {
              buffer: Buffer.from(await res.arrayBuffer()),
              suffix,
            };
          } catch (error) {
            logger.error(`Error downloading ${suffix} PDF:`, error);
            return null;
          }
        }),
      );

      const pdfBuffers = downloadResults.filter(
        (result) => result !== null,
      ) as Array<{ buffer: Buffer; suffix: string }>;

      if (pdfBuffers.length === 0) {
        logger.warn(`No PDFs successfully downloaded for: ${href}`);
        await context.close();
        await browser.close();
        resolve();
        return;
      }

      logger.info(
        `Downloaded ${pdfBuffers.length} PDF(s) for: ${href} (${pdfBuffers.map((p) => p.suffix).join(', ')})`,
      );

      // Write all downloaded PDFs
      // eslint-disable-next-line no-restricted-syntax
      for (const { buffer, suffix } of pdfBuffers) {
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
          content: buffer,
          extension: 'pdf',
          documentTitle: metadata?.title,
          getFileName: () => filePath,
        });
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
