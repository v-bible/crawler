import z from 'zod';
import { getDocumentId } from '@/lib/crawler/getId';
import { logError } from '@/lib/crawler/logUtils';
import {
  type Metadata,
  type MetadataInput,
  MetadataSchema,
} from '@/lib/crawler/schema';

const START_URL = 'https://tgpsaigon.net/giao-ly/';

export const getMetadataList = async () => {
  const baseMetadataInputs: MetadataInput[] = Array.from(
    { length: 12 },
    (_, idx) => {
      const gradeNum = idx + 1;
      return {
        documentNumber: gradeNum,
        documentId: getDocumentId({
          documentNumber: gradeNum,
          domain: 'R',
          subDomain: 'C',
          genre: 'C',
        }),
        title: `Hiệp thông ${gradeNum}`,
        author: 'Ban Giáo lý Tổng Giáo phận Sài Gòn',
        source: 'tgpsaigon.net',
        sourceType: 'web',
        sourceURL: START_URL,
        language: 'Việt',
        period: '21',
        publishedTime: '2021',
        genre: {
          code: 'C',
          category: 'catechesis',
          vietnamese: 'Giáo lý/Giáo huấn',
        },
        tags: [],
        hasChapters: true,
      } satisfies MetadataInput;
    },
  );

  const parsedMetadata = baseMetadataInputs
    .map((metadata): Metadata | null => {
      const parsed = MetadataSchema.safeParse(metadata);

      if (!parsed.success) {
        const errorContext = {
          documentId: metadata.documentId,
          metadata: {
            title: metadata.title,
            source: 'tgpsaigon.net',
          },
        };

        logError(
          `Invalid base metadata for tgpsaigon.net: ${JSON.stringify(metadata)}. Errors: ${z.treeifyError(
            parsed.error,
          )}`,
          errorContext,
        );
        return null;
      }

      return parsed.data;
    })
    .filter((m): m is Metadata => m !== null);

  return parsedMetadata;
};
