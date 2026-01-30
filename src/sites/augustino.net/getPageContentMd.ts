/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentMdFunction } from '@/lib/crawler/crawler';
import {
  cleanupMdProcessor,
  normalizeAsterisk,
  normalizeMd,
  normalizeNumberBullet,
  normalizeQuotes,
  normalizeWhitespace,
  removeMdHr,
  removeMdImgs,
  removeMdLinks,
  removeRedundantSpaces,
} from '@/lib/md/mdUtils';
import { parseMd } from '@/lib/md/remark';

const getPageContentMd = (({ resourceHref }) => {
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
          await page.goto(href);
        },
        {
          retries: 5,
        },
      );

      const bodyLocator = page.locator('div[id="fancybox-content"]');

      await bodyLocator.evaluate((node) => {
        // NOTE: Remove the footnote section if it exists
        node.querySelector('h3[id="chu-thich"]')?.remove();

        const allLinkEl = node.querySelectorAll('a');

        for (const linkEl of allLinkEl) {
          const fnId = linkEl.getAttribute('id');
          const fnHref = linkEl.getAttribute('href');
          const isFn = fnId?.startsWith('backtono');
          const isFnRef = fnHref?.startsWith('#backtono');

          if (isFn) {
            linkEl.innerHTML = `[^${linkEl.innerHTML}]`;
          } else if (isFnRef) {
            linkEl.innerHTML = `[^${linkEl.innerHTML}:]`;
          }
        }
      });

      const bodyHtml = await bodyLocator.innerHTML();

      await context.close();
      await browser.close();

      const md = await parseMd(bodyHtml);

      // NOTE: Footnote may have format: "[\[3\]](#footnote-link)" or
      // "[**\[3\]**](#footnote-link)" or "[3](#footnote-link)"
      const fnRegex =
        /\[[^\\[]*(\\\[)?(?<label>[^\\]*)(\\\])?[^\\\]]*\]\(([^)]*)\)/gm;

      const cleanupMd = cleanupMdProcessor(md, [
        removeMdImgs,
        (str) =>
          removeMdLinks(str, {
            useLinkAsAlt: false,
          }),
        removeMdHr,
        (str) => {
          return str.replaceAll(fnRegex, (subStr, ...props) => {
            // NOTE: Label is the first capturing group
            const label = props[1];
            // NOTE: We have inject "^" in the label above
            // NOTE: The colon we injected above will be included in the label
            if (label.includes(':')) {
              return `[${label.replace(':', '')}]:`;
            }
            return `[${label}]`;
          });
        },
        // NOTE: Have to run first so the asterisk regex can match correctly
        normalizeWhitespace,
        normalizeAsterisk,
        normalizeQuotes,
        normalizeNumberBullet,
        normalizeMd,
        removeRedundantSpaces,
        (str) => {
          // NOTE: Some pages has a list number which has multiple newlines, so we
          // have to remove newlines before the list number
          return str.replaceAll(/^(\d+)\n\n/gm, (subStr, ...props) => {
            const listNumber = props[0];
            return `${listNumber} `;
          });
        },
      ]);

      resolve(cleanupMd.trim());
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentMdFunction;

export { getPageContentMd };
