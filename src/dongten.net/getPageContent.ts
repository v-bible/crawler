/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import retry from 'async-retry';
import { chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type SingleLanguageSentence } from '@/lib/crawler/schema';
import { removeAllFootnote } from '@/lib/md/footnoteUtils';
import { extractHeading, removeAllHeading } from '@/lib/md/headingUtils';
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
  splitParagraph,
  stripSymbols,
} from '@/lib/md/mdUtils';
import { parseMd } from '@/lib/md/remark';
import { winkNLPInstance } from '@/lib/wink-nlp';

const getPageContent = (({ resourceHref, chapterParams }) => {
  return new Bluebird.Promise(async (resolve, reject, onCancel) => {
    const { href } = resourceHref;

    const browser = await chromium.launch();
    const context = await browser.newContext(devices['Desktop Chrome']);
    const page = await context.newPage();

    try {
      // Set up cancellation handler after resources are created
      onCancel!(async () => {
        await page.close();
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

      const bodyLocator = page
        .locator('div[class*="post-inner"]')
        .locator('div[class*="entry"]');

      await bodyLocator.evaluate((node) => {
        // NOTE: Remove post share buttons
        node.querySelector('div[class*="share-post"]')?.remove();
      });

      const bodyHtml = await bodyLocator.innerHTML();

      await context.close();
      await browser.close();

      const md = await parseMd(bodyHtml);

      const cleanupMd = cleanupMdProcessor(md, [
        removeMdImgs,
        (str) =>
          removeMdLinks(str, {
            useLinkAsAlt: false,
          }),
        removeMdHr,
        // NOTE: Have to run first so the asterisk regex can match correctly
        normalizeWhitespace,
        normalizeAsterisk,
        normalizeQuotes,
        normalizeNumberBullet,
        normalizeMd,
        removeRedundantSpaces,
      ]);

      const paragraphs = splitParagraph(cleanupMd, {
        headingAsParagraph: false,
      });

      const pageData = paragraphs.map((p, paragraphIdx) => {
        const pageNumber = paragraphIdx + 1;

        const paragraphId = getPageId({
          ...chapterParams,
          pageNumber,
        });

        const paragraphHeadings = extractHeading(p);

        // NOTE: If there are any headings in the paragraph, we will remove them
        p = removeAllHeading(p);

        const stripParagraph = stripSymbols(p).trim();

        // NOTE: Have to split markdown paragraphs by `\\\n` from markdown before
        // splitting sentences
        const sentences = stripParagraph
          .split('\\\n')
          .flatMap((subP) => winkNLPInstance.readDoc(subP).sentences().out())
          .filter((sentence) => {
            // NOTE: Filter out empty sentences
            return sentence.trim().length > 0;
          })
          .map((sentence) => {
            return {
              type: 'single',
              text: removeAllFootnote(sentence).trim(),
            } satisfies Omit<SingleLanguageSentence, 'id' | 'footnotes'>;
          })
          .filter((sentence) => {
            // NOTE: Filter out sentences that are only footnotes
            return sentence.text.length > 0;
          })
          .map((sentence, sentenceNumber) => {
            const newSentenceId = getSentenceId({
              ...chapterParams,
              pageNumber,
              sentenceNumber: sentenceNumber + 1,
            });
            return {
              ...sentence,
              id: newSentenceId,
              footnotes: [],
              headings:
                sentenceNumber === 0
                  ? paragraphHeadings.map((heading) => ({
                      ...heading,
                      text: stripSymbols(heading.text).trim(),
                      sentenceId: newSentenceId,
                    }))
                  : [],
            } satisfies SingleLanguageSentence;
          });

        return {
          id: paragraphId,
          number: pageNumber,
          sentences,
        };
      });

      resolve(pageData);
    } catch (error) {
      // Clean up resources on error
      await page.close();
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContent };
