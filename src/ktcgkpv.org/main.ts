import { groupBy } from 'es-toolkit';
import { DEFAULT_METADATA_FILE_PATH } from '@/constants';
import Bluebird from '@/lib/bluebird';
import {
  extractFootnote,
  injectFootnote,
  removeAllFootnote,
} from '@/lib/md/footnoteUtils';
import {
  cleanupMdProcessor,
  normalizeAsterisk,
  normalizeMd,
  normalizeNumberBullet,
  normalizeQuotes,
  normalizeWhitespace,
  removeRedundantSpaces,
  stripSymbols,
} from '@/lib/md/mdUtils';
import { Crawler, type GetChaptersFunction } from '@/lib/nlp/crawler';
import { getMetadataFromCSV } from '@/lib/nlp/crawlerUtils';
import { getPageId, getSentenceId } from '@/lib/nlp/getId';
import {
  type Footnote,
  type Heading,
  type Page,
  type SingleLanguageSentence,
} from '@/lib/nlp/schema';
import { winkNLPInstance } from '@/lib/wink-nlp';
import { logger } from '@/logger/logger';

const main = async () => {
  const bibleChaptersMetadata = (await (
    await fetch(
      'https://huggingface.co/datasets/v-bible/catholic-resources/resolve/main/books/bible/versions/ktcgkpv.org/kt2011/metadata.json',
    )
  ).json()) as Record<string, unknown>[];

  const crawler = new Crawler({
    name: 'ktcgkpv.org',
    domain: 'R',
    subDomain: 'C',
    getMetadataList: () => getMetadataFromCSV(DEFAULT_METADATA_FILE_PATH),
    getMetadataBy: (metadataRow) => {
      return (
        metadataRow.source === 'ktcgkpv.org' && metadataRow.sourceType === 'web'
      );
    },
    sortCheckpoint: (a, b) => {
      return (
        Number(a.params.requiresManualCheck === true) -
        Number(b.params.requiresManualCheck === true)
      );
    },
    getChapters: ({ resourceHref }) => {
      return new Bluebird.Promise((resolve) => {
        const bookCode = resourceHref.href.split('/').pop();

        const currentBookMeta = bibleChaptersMetadata.find(
          (item) => item.code === bookCode,
        );

        const baseURL = `https://huggingface.co/datasets/v-bible/bible/resolve/main/books/bible/versions/ktcgkpv.org/kt2011/${bookCode}`;

        resolve(
          (currentBookMeta?.chapters as Record<string, unknown>[])?.map(
            (chapter) => {
              return {
                href: `${baseURL}/${chapter.number}/${chapter.number}.json`,
                props: {
                  chapterNumber: chapter.number as number,
                  mdHref: `${baseURL}/${chapter.number}/${chapter.number}.md`,
                },
              } satisfies Awaited<ReturnType<GetChaptersFunction>>[number];
            },
          ) || [],
        );
      });
    },
    getPageContentHandler: {
      inputFn: ({ resourceHref, chapterParams }) => {
        return new Bluebird.Promise(async (resolve) => {
          const {
            verses,
            marks: footnotes = [],
            headings = [],
          } = await (await fetch(resourceHref.href)).json();

          const groupByParagraph = groupBy(
            verses,
            (item: Record<string, unknown>) => `${item.paragraphNumber}`,
          );

          const pageData = Object.keys(groupByParagraph).map((key) => {
            const pageNumber = +key + 1; // Convert key to number and add 1 for page number

            const paragraphId = getPageId({
              ...chapterParams,
              pageNumber,
            });
            return {
              id: paragraphId,
              number: pageNumber,
              sentences:
                groupByParagraph[key]
                  ?.flatMap((verse) => {
                    const verseHeadings = headings
                      .filter(
                        (heading: Record<string, unknown>) =>
                          heading.verseId === verse.id,
                      )
                      .map((heading: Record<string, unknown>) => {
                        return {
                          text: heading.text as string,
                          level: heading.level as number,
                          order: heading.sortOrder as number,
                        };
                      }) as Heading[];

                    // NOTE: The problem is verse footnotes and refs are calculated
                    // for a verse, which may contains multiple sentences. However,
                    // in the next steps, we will split into multiple sentences, we
                    // have to put refs back and then extract footnotes and refs
                    // again for each sentence.

                    const verseFootnotes = footnotes
                      .filter(
                        (fn: Record<string, unknown>) =>
                          fn.kind === 'MARK_KIND_FOOTNOTE' &&
                          fn.targetType === 'MARK_TARGET_TYPE_VERSE' &&
                          fn.targetId === verse.id,
                      )
                      .map((fn: Record<string, unknown>) => {
                        return {
                          text: fn.content as string,
                          position: fn.startOffset as number,
                          label: `${(fn.sortOrder as number) + 1}` as string,
                        };
                      });

                    const verseRefs = footnotes
                      .filter(
                        (fn: Record<string, unknown>) =>
                          fn.kind === 'MARK_KIND_REFERENCE' &&
                          fn.targetType === 'MARK_TARGET_TYPE_VERSE' &&
                          fn.targetId === verse.id,
                      )
                      .map((fn: Record<string, unknown>) => {
                        return {
                          text: fn.content as string,
                          position: fn.startOffset as number,
                          // NOTE: We add asterisk to the label to indicate it's a
                          // reference and not a footnote.
                          label: `${(fn.sortOrder as number) + 1}@`,
                        };
                      });

                    const cleanupMd = cleanupMdProcessor(verse.text as string, [
                      // NOTE: Have to run first so the asterisk regex can match correctly
                      normalizeWhitespace,
                      normalizeAsterisk,
                      normalizeQuotes,
                      normalizeNumberBullet,
                      normalizeMd,
                      removeRedundantSpaces,
                    ]);

                    // NOTE: Have to run before stripping markdown to prevent
                    // position of footnotes and refs from being changed.
                    const verseWithFootnotesAndRefs = injectFootnote(
                      cleanupMd,
                      [...verseFootnotes, ...verseRefs],
                    );

                    const stripContent = stripSymbols(
                      verseWithFootnotesAndRefs,
                    );

                    // NOTE: Since some verses might have multiple sentences, we have
                    // to use tokenizer to split them into sentences.
                    const sentences = winkNLPInstance
                      .readDoc(stripContent)
                      .sentences()
                      .out();

                    return sentences
                      .filter((sentence) => {
                        // NOTE: Filter out empty sentences
                        return sentence.trim().length > 0;
                      })
                      .map((sentence, idx) => {
                        // First, we extract footnotes and references from the split
                        // sentence.
                        const sentenceFootnotes = extractFootnote(
                          sentence,
                          /\[(?<label>[a-zA-Z0-9@]+)\]/gm,
                        ).flatMap((fn) => {
                          const isReference = fn.label.endsWith('@');

                          let verseFootnote: Record<string, unknown> | null =
                            null;

                          // Then we find the corresponding footnote or
                          // reference
                          if (isReference) {
                            verseFootnote = verseRefs.find(
                              (r: Record<string, unknown>) =>
                                r.label === fn.label,
                            );
                          } else {
                            verseFootnote = verseFootnotes.find(
                              (f: Record<string, unknown>) =>
                                f.label === fn.label,
                            );
                          }

                          if (!verseFootnote) {
                            logger.warn('Footnote text not found for label', {
                              href: resourceHref.href,
                              label: fn.label,
                            });
                            return [];
                          }

                          return [
                            {
                              text: removeAllFootnote(
                                verseFootnote.text as string,
                              ),
                              label: fn.label,
                              position: fn.position,
                            } satisfies Footnote,
                          ];
                        });

                        return {
                          type: 'single',
                          text: removeAllFootnote(sentence).trim() as string,
                          // NOTE: Headings always belong to the first sentence
                          headings: idx === 0 ? verseHeadings : [],
                          footnotes: sentenceFootnotes,
                          extraAttributes: {
                            number: verse.number as number,
                            subVerseIndex: verse.subVerseIndex as number,
                            // NOTE: Start from 0 for parNumber and parIndex
                            paragraphNumber: verse.paragraphNumber as number,
                            paragraphIndex: verse.paragraphIndex as number,
                            isPoetry: verse.isPoetry as boolean,
                            label: verse.label as string,
                          },
                        } satisfies Omit<
                          SingleLanguageSentence,
                          'id' | 'footnotes' | 'headings'
                        > & {
                          footnotes: Footnote[];
                          headings: Heading[];
                        };
                      });
                  })
                  .filter((sentence) => {
                    // NOTE: Filter out sentences that are only footnotes
                    return sentence.text.trim().length > 0;
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
                      headings: sentence.headings.map((heading) => ({
                        ...heading,
                        sentenceId: newSentenceId,
                      })),
                    } satisfies SingleLanguageSentence;
                  }) || [],
            } satisfies Page;
          });

          resolve(pageData);
        });
      },
    },
    getPageContentMd: ({ resourceHref }) => {
      return new Bluebird.Promise(async (resolve, reject) => {
        if (!resourceHref.props?.mdHref) {
          reject(new Error('MD href is not provided'));
          return;
        }

        const md = await (await fetch(resourceHref.props.mdHref)).text();

        resolve(md);
      });
    },
  });

  await crawler.run();
};

main();
