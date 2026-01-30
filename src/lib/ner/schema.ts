import { z } from 'zod/v4';
import {
  LanguageCodeSchema,
  MetadataSchema,
  MultiLanguageSentenceSchema,
  SentenceTypeSchema,
} from '@/lib/crawler/schema';
import { entityLabelCategories } from '@/lib/ner/mapping';

export const EntityLabelSchema = z.object({
  label: z.string(),
  category: z.string(),
});

export type EntityLabel = z.infer<typeof EntityLabelSchema>;

export const EntityAnnotationSchema = z.object({
  id: z.string().optional(),
  start: z.preprocess(
    (value) => (typeof value === 'string' ? parseInt(value, 10) : value),
    z.number().gte(0),
  ),
  end: z.preprocess(
    (value) => (typeof value === 'string' ? parseInt(value, 10) : value),
    z.number().gte(0),
  ),
  text: z.string(),
  labels: z.enum(entityLabelCategories.map((eL) => eL.label)).array(),
});

export type EntityAnnotation = z.infer<typeof EntityAnnotationSchema>;
export type EntityAnnotationInput = z.input<typeof EntityAnnotationSchema>;
export type EntityAnnotationOutput = z.output<typeof EntityAnnotationSchema>;

// NOTE: NER export with "JSON" format. For import, it may contains
// pre-annotations
export const NerDataSchema = z.object({
  annotations: z
    .object({
      result: z
        .object({
          value: EntityAnnotationSchema,
          // NOTE: Need these fields, so we can import annotated (not
          // pre-annotation or predicted) data back to Label Studio
          from_name: z.string(),
          to_name: z.string(),
          type: z.string(),
        })
        .array(),
    })
    .array()
    .optional(),
  data: z.object({
    text: z.string(),
    documentId: z.string(),
    chapterId: z.string(),
    sentenceId: z.string(),
    sentenceType: SentenceTypeSchema,
    languageCode:
      MultiLanguageSentenceSchema.shape.array.element.shape.languageCode.or(
        z.literal(''),
      ),
    title: MetadataSchema.shape.title,
    genreCode: MetadataSchema.shape.genre.shape.code,
  }),
});

export type NerData = z.infer<typeof NerDataSchema>;

export const SentenceEntityAnnotationSchema = EntityAnnotationSchema.omit({
  id: true,
}).extend({
  sentenceId: z.string(),
  sentenceType: SentenceTypeSchema,
  languageCode: LanguageCodeSchema.or(z.literal('')),
});

export type SentenceEntityAnnotation = z.infer<
  typeof SentenceEntityAnnotationSchema
>;
