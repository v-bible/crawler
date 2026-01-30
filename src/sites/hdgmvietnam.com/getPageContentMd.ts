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

      await page.evaluate(() => {
        // NOTE: Remove table element although remark-gfm still can parse it
        document.querySelectorAll('table').forEach((el) => el.remove());
      });

      const bodyLocator = page.locator(
        'div[class="detail-article main-content" i] > div',
      );

      await bodyLocator.evaluate((node) => {
        const allLinkEl = node.querySelectorAll('a');

        for (const linkEl of allLinkEl) {
          const fnName = linkEl.getAttribute('name');

          if (!fnName) {
            continue;
          }

          if (
            (fnName.includes('_ftn') || fnName.includes('_edn')) &&
            !fnName.includes('ref')
          ) {
            // NOTE: We have to add a colon to the end of the footnote label so it
            // will confront with github-flavored markdown
            linkEl.innerHTML = `[${linkEl.textContent?.replace('[', '').replace(']', '')}:]`;
          }
        }
      });

      const bodyHtml = await bodyLocator.innerHTML();

      await context.close();
      await browser.close();

      const md = await parseMd(bodyHtml);

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
            // NOTE: Label is the second capturing group
            const label = props[1];
            // NOTE: The colon we injected above will be included in the label
            if (label.includes(':')) {
              return `[^${label.replace(':', '')}]:`;
            }
            return `[^${label}]`;
          });
        },
        // NOTE: Have to run first so the asterisk regex can match correctly
        normalizeWhitespace,
        normalizeAsterisk,
        normalizeQuotes,
        normalizeNumberBullet,
        normalizeMd,
        removeRedundantSpaces,
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
