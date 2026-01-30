/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import retry from 'async-retry';
import { type Page, chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import {
  type Footnote,
  type SingleLanguageSentence,
} from '@/lib/crawler/schema';
import { extractFootnote, removeAllFootnote } from '@/lib/md/footnoteUtils';
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
import { logger } from '@/logger/logger';

// NOTE: This function is specific to the hdgmvietnam.com website
const extractFootnoteRef = async (
  page: Page,
): Promise<{
  footnoteRefs: Omit<Footnote, 'position'>[];
  newString: string;
}> => {
  const bodyLocator = page.locator(
    'div[class="detail-article main-content" i] > div',
  );

  const { footnoteRefs, newString } = await bodyLocator.evaluate((node) => {
    let fnRef: Omit<Footnote, 'position'>[] = [];

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
        const footnoteLabel =
          linkEl.textContent?.replace('[', '').replace(']', '') || '';

        // NOTE: Store parent element before removing footnote label
        const parentElement = linkEl.closest('p');

        linkEl.remove();

        const text = parentElement?.textContent || '';

        fnRef = [
          ...fnRef,
          {
            label: footnoteLabel,
            // NOTE: Footnote text has weird \n characters, so we replace them with space
            text: text.replaceAll('\n', ' ').trim(),
          },
        ];

        // NOTE: Remove all the footnote references from the body HTML
        parentElement?.remove();
      }
    }

    return {
      footnoteRefs: fnRef,
      newString: node.innerHTML,
    };
  });

  return {
    footnoteRefs,
    newString,
  };
};

const getPageContent = (({ resourceHref, chapterParams }) => {
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

      const { footnoteRefs, newString } = await extractFootnoteRef(page);

      await context.close();
      await browser.close();

      const md = await parseMd(newString);

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
            // NOTE: Label is the second capturing group
            const label = props[1];
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
            const footnotes = extractFootnote(sentence).flatMap((fnPos) => {
              const footnoteRef = footnoteRefs.find(
                (fnText) => fnText.label === fnPos.label,
              );
              if (!footnoteRef) {
                logger.warn('Footnote text not found for label', {
                  href: resourceHref.href,
                  label: fnPos.label,
                });

                return [];
              }

              return [
                {
                  ...footnoteRef,
                  text: stripSymbols(footnoteRef.text).trim(),
                  position: fnPos.position,
                },
              ];
            });

            return {
              type: 'single',
              text: removeAllFootnote(sentence).trim(),
              footnotes,
            } satisfies Omit<SingleLanguageSentence, 'id' | 'footnotes'> & {
              footnotes: Footnote[];
            };
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
              footnotes: sentence.footnotes.map((fn, idx) => ({
                ...fn,
                order: idx,
                sentenceId: newSentenceId,
              })),
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
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContent };
