/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { uniqBy } from 'es-toolkit';
import z from 'zod';
import { getDocumentId } from '@/lib/crawler/getId';
import { MetadataInput, MetadataSchema } from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

export const getMetadataListDaily = async () => {
  const startDate = new Date(2024, 0, 1); // January 1, 2024
  const today = new Date();

  const metadataList = Array.from({
    length: differenceInCalendarDays(today, startDate),
  }).map((_, index) => {
    const currDate = addDays(startDate, index);
    const currDateStr = format(currDate, 'yyyy-MM-dd');

    const link = `https://augustino.net/loi-chua-hom-nay?y=${currDate.getFullYear()}&m=${
      currDate.getMonth() + 1
    }&d=${currDate.getDate()}`;

    const metadata = {
      documentNumber: index + 1,
      documentId: getDocumentId({
        documentNumber: index + 1,
        domain: 'R',
        subDomain: 'C',
        genre: 'Z',
      }),
      title: `Phụng Vụ Lời Chúa Ngày ${currDateStr}`,
      sourceType: 'web',
      sourceURL: link,
      language: 'Việt',
      period: '21',
      publishedTime: currDateStr,
      genre: {
        code: 'Z',
        category: 'others',
        vietnamese: 'Khác',
      },
      tags: [],
    } satisfies MetadataInput;

    const parsedMetadata = MetadataSchema.safeParse(metadata);

    if (!parsedMetadata.success) {
      logger.error(
        `Invalid metadata parsed: ${JSON.stringify(
          metadata,
        )}. Errors: ${z.treeifyError(parsedMetadata.error)}`,
      );

      // eslint-disable-next-line no-continue
      return [];
    }

    logger.info(`Fetched: Phụng Vụ Lời Chúa Ngày ${currDateStr} - ${link}`);

    return [parsedMetadata.data];
  });

  return uniqBy(metadataList.flat(), (item) => item.sourceURL);
};
