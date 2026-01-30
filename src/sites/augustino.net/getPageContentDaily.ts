/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import retry from 'async-retry';
import { type Locator, chromium, devices } from 'playwright';
import Bluebird from '@/lib/bluebird';
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type Page, type SingleLanguageSentence } from '@/lib/crawler/schema';
import { removeAllFootnote } from '@/lib/md/footnoteUtils';
import {
  cleanupMdProcessor,
  normalizeAsterisk,
  normalizeMd,
  normalizeNumberBullet,
  normalizeQuotes,
  normalizeWhitespace,
  removeMdHr,
  removeRedundantSpaces,
} from '@/lib/md/mdUtils';
import { parseMd } from '@/lib/md/remark';
import { winkNLPInstance } from '@/lib/wink-nlp';

// NOTE: "\p{L}" is for unicode letter (Vietnamese characters from ktcgkpv.org).
// Example: $1$, $1a$, $ $ and $3-4$. The verseNum will only match the first
// number in "$3-4$" case
const reVerseNumMatch = /\$(?<verseNum>\d+\p{L}*| )(-\d+\p{L}*)?\$/gmu;

const processGospel = async (locator: Locator) => {
  await locator.evaluate((element) => {
    // NOTE: First we wrap it with $ for every sup as verse number because
    // some sup for verse num is omitted
    element.querySelectorAll('sub').forEach((el) => {
      el.innerHTML = `$${el.innerHTML}$`;
    });
  });

  const parsedContent = await parseMd(await locator.innerHTML());

  const cleanupMd = cleanupMdProcessor(parsedContent as string, [
    removeMdHr,
    // NOTE: Have to run first so the asterisk regex can match correctly
    normalizeWhitespace,
    normalizeAsterisk,
    normalizeQuotes,
    normalizeNumberBullet,
    normalizeMd,
    removeRedundantSpaces,
  ]);

  const paragraphs = cleanupMd
    .replaceAll(/\\$/gmu, '\n')
    // NOTE: We split by paragraph but ignore headings (appended with &&)
    .split(/(?<!&&\n?)\n/gm)
    .filter((p) => p.trim() !== '');

  const sentenceData: Omit<
    SingleLanguageSentence,
    'id' | 'footnotes' | 'headings'
  >[] = [];

  // NOTE: We ensure that the order of split verses like '4a', '4b', '4c' is
  // correct
  const verseOrderTrack = {
    number: 0,
    subVerseIndex: 0,
  };

  for await (const [index, paragraph] of paragraphs.entries()) {
    // NOTE: We split by verses using verse pattern $4$, $ $ or $3-4$
    // NOTE: Always split using non-capturing group (?:)
    const verses = paragraph.split(/(?=\$(?:\d+\p{L}*| )(?:-\d+\p{L}*)?\$)/gmu);

    // eslint-disable-next-line no-restricted-syntax
    for (const [verseIndex, verse] of verses.entries()) {
      const verseNumMatch = reVerseNumMatch.exec(verse);
      const verseNum = parseInt(verseNumMatch?.groups?.verseNum || '', 10);

      let currentVerseNumber = Number.isNaN(verseNum) ? null : verseNum;

      if (currentVerseNumber === null) {
        // NOTE: If the verse number is null, we set to current verse number
        // track
        currentVerseNumber = verseOrderTrack.number;
      }

      if (currentVerseNumber !== verseOrderTrack.number) {
        verseOrderTrack.number = currentVerseNumber;
        verseOrderTrack.subVerseIndex = 0;
      } else {
        verseOrderTrack.subVerseIndex += 1;
      }

      const content = verse.replaceAll(reVerseNumMatch, '').trim();

      sentenceData.push({
        type: 'single',
        text: removeAllFootnote(content).trim(),
        extraAttributes: {
          number: verseOrderTrack.number,
          subVerseIndex: verseOrderTrack.subVerseIndex,
          // NOTE: Start from 0 for parNumber and parIndex
          paragraphNumber: index,
          paragraphIndex: verseIndex,
          isPoetry: false,
          label: verseNumMatch?.[0].replaceAll('$', '') || '',
        },
      } satisfies Omit<
        SingleLanguageSentence,
        'id' | 'footnotes' | 'headings'
      >);
    }
  }

  return sentenceData;
};

const getPageContentDaily = (({ resourceHref, chapterParams }) => {
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

      const bodyBlockLocator = await page
        .locator('div.reading-blocks > div.reading-block')
        .all();

      const scriptureBlocks = bodyBlockLocator.slice(0, -1);

      const contentBlock = bodyBlockLocator.at(-1);

      const sentenceData: Omit<
        SingleLanguageSentence,
        'id' | 'footnotes' | 'headings'
      >[] = [];

      // NOTE: Process all scripture blocks
      for await (const block of scriptureBlocks) {
        const blockSentences = await processGospel(block);
        sentenceData.push(...blockSentences);
      }

      const contentParagraphs = (await contentBlock?.locator('p').all()) || [];

      const contentSentences: Omit<
        SingleLanguageSentence,
        'id' | 'footnotes' | 'headings'
      >[] = [];

      for await (const paragraphLocator of contentParagraphs) {
        const paragraphText = (await paragraphLocator.textContent()) || '';
        const sentences = winkNLPInstance
          .readDoc(paragraphText)
          .sentences()
          .out()
          .map((sentence) => {
            return {
              type: 'single',
              text: sentence.trim(),
            } satisfies Omit<
              SingleLanguageSentence,
              'id' | 'footnotes' | 'headings'
            >;
          });
        contentSentences.push(...sentences);
      }

      const newSentences = [...sentenceData, ...contentSentences].map(
        (sentence, sentenceNumber) => {
          const newSentenceId = getSentenceId({
            ...chapterParams,
            pageNumber: 1,
            sentenceNumber: sentenceNumber + 1,
          });

          return {
            ...sentence,
            id: newSentenceId,
            footnotes: [],
            headings: [],
          };
        },
      );

      const pageData = [
        {
          id: getPageId({
            ...chapterParams,
            pageNumber: 1,
          }),
          number: 1,
          sentences: newSentences,
        } satisfies Page,
      ];

      // Clean up resources
      await context.close();
      await browser.close();

      resolve(pageData);
    } catch (error) {
      // Clean up resources on error
      await context.close();
      await browser.close();

      reject(error);
    }
  });
}) satisfies GetPageContentFunction;

export { getPageContentDaily };
