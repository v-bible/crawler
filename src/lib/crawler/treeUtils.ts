import { isValid, parse } from 'date-fns';
import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import { type Child, x } from 'xastscript';
import { getChapterId, getDocumentId } from '@/lib/crawler/getId';
import {
  type ChapterParams,
  ChapterParamsSchema,
  type LanguageCode,
  type MetadataInput,
  MetadataSchema,
  type Page,
  type Sentence,
  type SentenceHeading,
  type TreeFootnote,
} from '@/lib/crawler/schema';
import {
  type ChapterTree,
  type ChapterTreeOutput,
  ChapterTreeSchema,
} from '@/lib/crawler/treeSchema';
import { wrapNERLabel } from '@/lib/ner/nerUtils';
import { type SentenceEntityAnnotation } from '@/lib/ner/schema';

const newLineIndent = (level: number, indentationSize = 2) => {
  return u('text', `\n${' '.repeat(level * indentationSize)}`);
};

// NOTE: Do not add u('text', ' ') here, it will break the XML formatting.
// Remember to add "{}" before "...generateIndent" to avoid the first newLine is
// passed as node value
const generateIndent = (level: number, child: Array<Child>) => {
  return [
    ...child.flatMap((c) => {
      return [newLineIndent(level), c];
    }),
    newLineIndent(level > 0 ? level - 1 : level),
  ];
};

export const defaultTransformString = (str: string) => {
  return str;
};

export const defaultParseDate = (date: string): Date => {
  const formats = ['dd/MM/yyyy', 'yyyy'];

  const parsedDate = formats
    .map((fmt) => parse(date, fmt, new Date()))
    .find((parsed) => isValid(parsed));

  if (parsedDate) {
    return parsedDate;
  }

  throw new Error(`Invalid date format: ${date}`);
};

export type GenerateTreeParams = {
  chapterParams: ChapterParams;
  metadata: MetadataInput;
  pages: Page[];
  footnotes: TreeFootnote[];
  headings: SentenceHeading[];
  annotations?: SentenceEntityAnnotation[];
};

export type GenerateTreeOptions = {
  transformString?: (
    str: string,
    params: {
      sentenceId: string;
      languageCode?: LanguageCode;
    },
  ) => string;
  parseDate?: (date: string) => Date;
};

export type GenerateTreeFunction = (
  params: GenerateTreeParams,
  options?: GenerateTreeOptions,
) => ChapterTreeOutput;

export type StringifyTreeFunction = (
  tree: ChapterTreeOutput,
  options?: Record<string, unknown>,
) => {
  content: string;
  extension: string;
};

const generateXmlTree: StringifyTreeFunction = (chapterTree) => {
  const xmlTree = x(
    'root',
    {},
    ...generateIndent(1, [
      x(
        'FILE',
        { ID: chapterTree.root.file.id, NUMBER: chapterTree.root.file.number },
        ...generateIndent(2, [
          x(
            'meta',
            {},
            ...generateIndent(3, [
              x('DOCUMENT_ID', chapterTree.root.file.meta.documentId),
              x('DOCUMENT_NUMBER', chapterTree.root.file.meta.documentNumber),
              x(
                'GENRE',
                {},
                ...generateIndent(4, [
                  x('CODE', chapterTree.root.file.meta.genre.code),
                  x('CATEGORY', chapterTree.root.file.meta.genre.category),
                  x('VIETNAMESE', chapterTree.root.file.meta.genre.vietnamese),
                ]),
              ),
              x(
                'TAGS',
                {},
                ...generateIndent(4, [
                  ...(chapterTree.root.file.meta.tags?.map(
                    ({ category, vietnamese }) => {
                      return x(
                        'TAG',
                        {},
                        ...generateIndent(5, [
                          x('CATEGORY', category),
                          x('VIETNAMESE', vietnamese),
                        ]),
                      );
                    },
                  ) || []),
                ]),
              ),
              x('TITLE', chapterTree.root.file.meta.title),
              x('VOLUME', chapterTree.root.file.meta.volume),
              x('AUTHOR', chapterTree.root.file.meta.author),
              x('SOURCE_TYPE', chapterTree.root.file.meta.sourceType),
              x('SOURCE_URL', chapterTree.root.file.meta.sourceURL),
              x('SOURCE', chapterTree.root.file.meta.source),
              x(
                'HAS_CHAPTERS',
                chapterTree.root.file.meta.hasChapters ? 'true' : 'false',
              ),
              x('PERIOD', chapterTree.root.file.meta.period),
              x('PUBLISHED_TIME', chapterTree.root.file.meta.publishedTime),
              x('LANGUAGE', chapterTree.root.file.meta.language),
              x('NOTE', chapterTree.root.file.meta.note),
            ]),
          ),

          x(
            'SECT',
            {
              ID: chapterTree.root.file.sect.id,
              NAME: chapterTree.root.file.sect.name,
              NUMBER: chapterTree.root.file.sect.number,
            },
            ...generateIndent(3, [
              ...chapterTree.root.file.sect.pages.map((page) => {
                return x(
                  'PAGE',
                  {
                    ID: page.id,
                    NUMBER: page.number,
                  },
                  ...generateIndent(
                    4,
                    page.sentences.map((sentence) => {
                      const extraAttributes = sentence?.extraAttributes;
                      const newExtraAttributes: Record<string, string> = {};

                      if (extraAttributes) {
                        Object.entries(extraAttributes).forEach(
                          ([key, value]) => {
                            // NOTE: Convert camelCase to snake_case then to UPPERCASE
                            const newKey = key
                              .replace(/([a-z])([A-Z])/g, '$1_$2')
                              .toUpperCase();

                            newExtraAttributes[newKey] = String(value);
                          },
                        );
                      }

                      if (sentence.type === 'single') {
                        return x(
                          'STC',
                          {
                            ID: sentence.id,
                            TYPE: sentence.type,
                            LANGUAGE_CODE: sentence.languageCode,
                            ...newExtraAttributes,
                          },
                          sentence.text,
                        );
                      }

                      return x(
                        'STC',
                        {
                          ID: sentence.id,
                          TYPE: sentence.type,
                          ...newExtraAttributes,
                        },
                        ...generateIndent(
                          5,
                          sentence.array.map((lang) => {
                            return x(lang.languageCode, {}, lang.text);
                          }),
                        ),
                      );
                    }),
                  ),
                );
              }),

              x(
                'FOOTNOTES',
                {},
                ...generateIndent(
                  4,
                  chapterTree.root.file.sect.footnotes?.map((footnote) => {
                    return x(
                      'FOOTNOTE',
                      {
                        SENTENCE_ID: footnote.sentenceId,
                        LABEL: footnote.label,
                        POSITION: footnote.position,
                        ORDER: footnote.order,
                      },
                      footnote.text,
                    );
                  }) || [],
                ),
              ),

              x(
                'HEADINGS',
                {},
                ...generateIndent(
                  4,
                  chapterTree.root.file.sect.headings?.map((heading) => {
                    return x(
                      'HEADING',
                      {
                        SENTENCE_ID: heading.sentenceId,
                        LEVEL: heading.level,
                        ORDER: heading.order,
                      },
                      heading.text,
                    );
                  }) || [],
                ),
              ),

              x(
                'ANNOTATIONS',
                {},
                ...generateIndent(
                  4,
                  chapterTree.root.file.sect.annotations?.map((annotation) => {
                    return x(
                      'ANNOTATION',
                      {
                        SENTENCE_ID: annotation.sentenceId,
                        SENTENCE_TYPE: annotation.sentenceType,
                        LANGUAGE_CODE: annotation.languageCode,
                        START: annotation.start.toString(),
                        END: annotation.end.toString(),
                        LABEL: annotation.labels[0]!,
                      },
                      annotation.text,
                    );
                  }) || [],
                ),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  );

  // Convert the tree to XML string
  // REVIEW: Might have some "<" in the sentence, not the "<" opening tag
  return {
    content: toXml(xmlTree).replaceAll('&#x3C;', '<').trim(),
    extension: 'xml',
  };
};

const generateJsonTree: StringifyTreeFunction = (chapterTree) => {
  return { content: JSON.stringify(chapterTree, null, 2), extension: 'json' };
};

const generateDataTree = ((
  { chapterParams, metadata, pages, footnotes, headings, annotations },
  options,
) => {
  const {
    transformString = defaultTransformString,
    parseDate = defaultParseDate,
  } = options || {};

  // ✅ Validate input
  const parsedChapterParams = ChapterParamsSchema.parse(chapterParams);

  const parsedMetadata = MetadataSchema.extend({
    publishedTime: MetadataSchema.shape.publishedTime.refine(
      (date) => {
        if (date === '') {
          return true;
        }

        try {
          parseDate(date);
          return true;
        } catch {
          return false;
        }
      },
      {
        message: 'Invalid date format',
      },
    ),
  }).parse(metadata);

  const documentId = getDocumentId({
    domain: chapterParams.domain,
    subDomain: chapterParams.subDomain,
    genre: chapterParams.genre,
    documentNumber: chapterParams.documentNumber,
  });
  const chapterId = getChapterId({
    domain: chapterParams.domain,
    subDomain: chapterParams.subDomain,
    genre: chapterParams.genre,
    documentNumber: chapterParams.documentNumber,
    chapterNumber: chapterParams.chapterNumber,
  });

  const jsonTree = {
    root: {
      file: {
        id: documentId,
        number: parsedMetadata.documentNumber,
        meta: {
          ...parsedMetadata,
          documentId,
          genre: {
            code: parsedMetadata.genre.code,
            category: parsedMetadata.genre.category,
            vietnamese: parsedMetadata.genre.vietnamese,
          },
        },

        sect: {
          id: chapterId,
          name: parsedChapterParams.chapterName,
          number: parsedChapterParams.chapterNumber,
          pages: pages.map((page) => {
            return {
              id: page.id,
              number: page.number,
              sentences: page.sentences.map((sentence) => {
                if (sentence.type === 'single') {
                  return {
                    id: sentence.id,
                    type: sentence.type,
                    languageCode: sentence.languageCode,
                    extraAttributes: sentence.extraAttributes,
                    text: transformString(sentence.text, {
                      sentenceId: sentence.id,
                    }),
                  };
                }

                return {
                  id: sentence.id,
                  type: sentence.type,
                  extraAttributes: sentence.extraAttributes,
                  array: sentence.array.map((lang) => {
                    return {
                      languageCode: lang.languageCode,
                      text: transformString(lang.text, {
                        sentenceId: sentence.id,
                        languageCode: lang.languageCode,
                      }),
                    };
                  }),
                };
              }) satisfies Sentence[],
            };
          }),
          footnotes,
          headings,
          annotations,
        },
      },
    },
  } satisfies ChapterTree;

  // NOTE: Validate the JSON structure
  const parsedTree = ChapterTreeSchema.parse(jsonTree);

  return parsedTree;
}) satisfies GenerateTreeFunction;

const generateDataTreeWithAnnotation = (
  {
    chapterParams,
    metadata,
    pages,
    footnotes,
    headings,
    annotations,
  }: GenerateTreeParams & { annotations: SentenceEntityAnnotation[] },
  options?: GenerateTreeOptions,
): ChapterTreeOutput => {
  return generateDataTree(
    { chapterParams, metadata, pages, footnotes, headings, annotations },
    {
      ...options,
      transformString: (str, { sentenceId, languageCode }) => {
        const sentenceAnnotations = annotations.filter((annotation) => {
          const annotationLangCode =
            // NOTE: languageCode in sentence doesn't accept empty string
            // literal but in annotation does, so we need to handle it
            annotation.languageCode === ''
              ? undefined
              : annotation.languageCode;

          return (
            annotation.sentenceId === sentenceId &&
            annotationLangCode === languageCode
          );
        });

        const newStr = wrapNERLabel(str, sentenceAnnotations);

        return newStr;
      },
    },
  );
};

const generateCsvTree: StringifyTreeFunction = (
  chapterTree,
  options?: {
    sentenceIdLabel?: string;
    languageCodeLabel?: string;
    textLabel?: string;
  },
) => {
  const {
    sentenceIdLabel = 'sentence_id',
    languageCodeLabel = 'language_code',
    textLabel = 'text',
  } = options || {};

  let csvContent = `"${sentenceIdLabel}","${languageCodeLabel}","${textLabel}"\n`;

  chapterTree.root.file.sect.pages.forEach((page) => {
    page.sentences.forEach((sentence) => {
      if (sentence.type === 'single') {
        csvContent += `"${sentence.id}","${sentence.languageCode}", "${sentence.text.replace(
          /"/g,
          '""',
        )}"\n`;
      } else {
        sentence.array.forEach((lang) => {
          csvContent += `"${sentence.id}","${lang.languageCode}", "${lang.text.replace(
            /"/g,
            '""',
          )}"\n`;
        });
      }
    });
  });

  return { content: csvContent.trim(), extension: 'csv' };
};

export {
  newLineIndent,
  generateIndent,
  generateDataTree,
  generateDataTreeWithAnnotation,
  generateXmlTree,
  generateJsonTree,
  generateCsvTree,
};
