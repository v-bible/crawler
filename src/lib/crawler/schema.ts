import { z } from 'zod';
import {
  domainCategories,
  genreCategories,
  languageCategories,
  subDomainCategories,
  tagCategories,
} from '@/mapping';

export const CATEGORY_SEPARATOR = '|';

export const CategorySchema = z.object({
  code: z.string(),
  category: z.string(),
  vietnamese: z.string(),
  categoryType: z.enum(['domain', 'subDomain', 'genre', 'tag', 'language']),
  isReserved: z.boolean().optional(),
});

export type Category = z.infer<typeof CategorySchema>;

export const CamelCaseStringSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, {
  message: 'String must be in camelCase format',
});

export const IdParamsSchema = z.object({
  domain: z.enum(domainCategories.map((c) => c.code)),
  subDomain: z.enum(subDomainCategories.map((c) => c.code)),
  genre: z.enum(
    genreCategories.filter((c) => !c.isReserved).map((c) => c.code),
  ),
  documentNumber: z.number().gte(0),
  chapterNumber: z.number().gte(0),
  pageNumber: z.number().gte(0),
  sentenceNumber: z.number().gte(0),
});

export type IdParams = z.infer<typeof IdParamsSchema>;

export type GenreParams = Pick<IdParams, 'domain' | 'subDomain' | 'genre'>;

export type DocumentParams = Pick<
  IdParams,
  'domain' | 'subDomain' | 'genre' | 'documentNumber'
>;

export const ChapterParamsSchema = IdParamsSchema.omit({
  pageNumber: true,
  sentenceNumber: true,
}).extend({
  chapterName: z.string().optional().default(''),
});

export type ChapterParams = z.infer<typeof ChapterParamsSchema>;

export type PageParams = Pick<
  IdParams,
  | 'domain'
  | 'subDomain'
  | 'genre'
  | 'documentNumber'
  | 'chapterNumber'
  | 'pageNumber'
>;

export type SentenceParams = IdParams;

export const MetadataSchema = z.object({
  documentId: z.string(),
  documentNumber: IdParamsSchema.shape.documentNumber,
  genre: z
    .object({
      code: IdParamsSchema.shape.genre,
      category: z
        .enum(
          genreCategories
            .filter((gC) => !gC.isReserved)
            .map((gC) => gC.category),
        )
        .or(z.literal('')),
      vietnamese: z
        .enum(
          genreCategories
            .filter((gC) => !gC.isReserved)
            .map((gC) => gC.vietnamese),
        )
        .or(z.literal('')),
    })
    .refine(
      (val) => {
        // NOTE: Check if vietnamese is translated from category
        const category = genreCategories.find(
          (gC) => gC.category === val.category,
        );

        return !!category && category.vietnamese === val.vietnamese;
      },
      {
        message: 'Invalid genre category or vietnamese translation',
      },
    ),
  tags: z
    .object({
      category: z
        .enum(tagCategories.map((tC) => tC.category))
        .or(z.literal('')),
      vietnamese: z
        .enum(tagCategories.map((tC) => tC.vietnamese))
        .or(z.literal('')),
    })
    .refine(
      (val) => {
        // NOTE: Tags can be empty, in which case we don't validate
        if (val.category === '') {
          return true;
        }

        // NOTE: Check if vietnamese is translated from category
        const category = tagCategories.find(
          (gC) => gC.category === val.category,
        );

        return !!category && category.vietnamese === val.vietnamese;
      },
      {
        message: 'Invalid tag category or vietnamese translation',
      },
    )
    .array(),
  title: z.string(),
  volume: z.string().optional().default(''),
  author: z.string().optional().default(''),
  sourceType: z.enum(['web', 'pdf', 'hardCopy']),
  sourceURL: z.url().or(z.literal('')).optional().default(''),
  source: z.string().optional().default(''),
  hasChapters: z.boolean().optional().default(false),
  period: z.string().optional().default(''),
  publishedTime: z.string().optional().default(''),
  language: z.enum(languageCategories.map((lC) => lC.vietnamese)),
  // NOTE: Should not include in dataTree
  requiresManualCheck: z.boolean().optional().default(false),
  note: z.string().optional().default(''),
});

export type Metadata = z.infer<typeof MetadataSchema>;
export type MetadataInput = z.input<typeof MetadataSchema>;
export type MetadataOutput = z.output<typeof MetadataSchema>;

export const MetadataRowCSVSchema = MetadataSchema.omit({
  genre: true,
  tags: true,
}).extend({
  documentNumber: z.preprocess((val) => {
    if (typeof val === 'string') {
      return Number.parseInt(val, 10);
    }
    return val;
  }, IdParamsSchema.shape.documentNumber),
  genreCode: IdParamsSchema.shape.genre,
  genreCategory: MetadataSchema.shape.genre.shape.category,
  genreVietnamese: MetadataSchema.shape.genre.shape.vietnamese,
  // NOTE: tagCategory will have format: "tag1 | tag2 | tag3". The same for
  // tagVietnamese
  tagCategory: z.preprocess((val: string) => {
    return val.split(CATEGORY_SEPARATOR).map((tag) => tag.trim());
  }, MetadataSchema.shape.tags.element.shape.category.array()),
  tagVietnamese: z.preprocess((val: string) => {
    return val.split(CATEGORY_SEPARATOR).map((tag) => tag.trim());
  }, MetadataSchema.shape.tags.element.shape.vietnamese.array()),
  hasChapters: z
    .stringbool({
      truthy: ['true', '1'],
      falsy: ['false', '0'],
    })
    .default(false),
  requiresManualCheck: z
    .stringbool({
      truthy: ['true', '1'],
      falsy: ['false', '0'],
    })
    .default(false),
});

export type MetadataRowCSV = z.infer<typeof MetadataRowCSVSchema>;
export type MetadataRowCSVInput = z.input<typeof MetadataRowCSVSchema>;
export type MetadataRowCSVOutput = z.output<typeof MetadataRowCSVSchema>;

export const FootnoteSchema = z.object({
  label: z.string(),
  text: z.string(),
  position: z.number().gte(0),
});

export type Footnote = z.infer<typeof FootnoteSchema>;

// NOTE: Add sentenceId to FootnoteSchema to link footnotes to sentences
export const SentenceFootnoteSchema = FootnoteSchema.extend({
  sentenceId: z.string(),
});

export type SentenceFootnote = z.infer<typeof SentenceFootnoteSchema>;

// NOTE: Usually footnotes order is only known when building chapter tree
export const TreeFootnoteSchema = SentenceFootnoteSchema.extend({
  order: z.number().gte(0),
});

export type TreeFootnote = z.infer<typeof TreeFootnoteSchema>;

export const HeadingSchema = z.object({
  text: z.string(),
  level: z.number().gte(1).lte(6),
  order: z.number().gte(0),
});

export type Heading = z.infer<typeof HeadingSchema>;

// NOTE: SentenceHeadingSchema is used to link headings to sentences
export const SentenceHeadingSchema = HeadingSchema.extend({
  sentenceId: z.string(),
});

export type SentenceHeading = z.infer<typeof SentenceHeadingSchema>;

export const SentenceTypeSchema = z.enum(['single', 'multiple']);

export type SentenceType = z.infer<typeof SentenceTypeSchema>;

const BaseSentenceSchema = z.object({
  id: z.string(),
  type: SentenceTypeSchema,
  headings: SentenceHeadingSchema.array().optional(),
  extraAttributes: z
    .record(CamelCaseStringSchema, z.string().or(z.number()).or(z.boolean()))
    .optional(),
});

export const LanguageCodeSchema = z.enum(
  languageCategories.map((lC) => lC.code),
);

export const SingleLanguageSentenceSchema = BaseSentenceSchema.extend({
  type: SentenceTypeSchema.extract(['single']),
  languageCode: LanguageCodeSchema,
  text: z.string(),
  footnotes: SentenceFootnoteSchema.array().optional(),
});

export type SingleLanguageSentence = z.infer<
  typeof SingleLanguageSentenceSchema
>;

export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

export const MultiLanguageSentenceSchema = BaseSentenceSchema.extend({
  type: SentenceTypeSchema.extract(['multiple']),
  array: z
    .object({
      languageCode: LanguageCodeSchema,
      text: z.string(),
      footnotes: SentenceFootnoteSchema.array().optional(),
    })
    .array(),
});

export type MultiLanguageSentence = z.infer<typeof MultiLanguageSentenceSchema>;

// NOTE: Support multiple languages in sentences
export const SentenceSchema = SingleLanguageSentenceSchema.or(
  MultiLanguageSentenceSchema,
);

export type Sentence = z.infer<typeof SentenceSchema>;

export const PageSchema = z.object({
  id: z.string(),
  number: IdParamsSchema.shape.pageNumber,
  sentences: SentenceSchema.array(),
});

export type Page = z.infer<typeof PageSchema>;
