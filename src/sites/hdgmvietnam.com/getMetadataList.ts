/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { format } from 'date-fns';
import { uniqBy } from 'es-toolkit';
import z from 'zod';
import { getDocumentId } from '@/lib/crawler/getId';
import { MetadataInput, MetadataSchema } from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

const postTagSection = [
  'loi-chua-hang-ngay',
  'cau-nguyen',
  'phut-suy-tu',
  'guong-chung-nhan',
  'thoi-su-giao-hoi-hoan-vu',
  'thoi-su-giao-hoi-viet-nam',
  'tai-lieu',
  'tin-tuc',
  'bai-viet',
  'thanh-nhac',
  'nghe-thuat-thanh',
  'duc-tin-',
  'kinh-thanh',
  'giao-duc',
  'giao-dan',
  'gia-dinh',
  'gioi-tre',
  'thieu-nhi',
  'di-dan',
  'linh-muc',
  'tu-si',
  'chung-sinh',
  'giam-muc',
  'thong-diep',
  'thanh-bo',
  'bai-giang',
  'kinh-truyen-tin',
  'dien-van',
  'tong-huan',
  'tong-hien',
  'tiep-kien-chung',
  'tong-thu',
  'su-diep',
  'thu-chung',
  'thu-muc-vu-giao-phan',
  'van-kien-hdgmvn',
  'thu-muc-vu-hdgmvn',
  'thanh-tu-dao',
  'lich-su',
];

export const getMetadataList = async () => {
  let currentDocumentNumber = 1;
  const metadataList: MetadataInput[] = [];

  for await (const link of postTagSection) {
    const baseLink = `https://hdgmvietnam.com/api/posts?sub-id=${link}`;

    const baseRes = await fetch(baseLink);
    const baseData = await baseRes.json();

    const pageNumber = baseData.pageData.pageCount;

    for (let i = 0; i <= pageNumber; i += 1) {
      const pageLink = `${baseLink}&page=${i}`;

      const response = await fetch(pageLink);
      const data = await response.json();

      for await (const item of data.value) {
        const title = item.title || '';
        const href = `https://hdgmvietnam.com/chi-tiet/${item.link}`;

        const fmtDate = format(new Date(item.publishDate), 'dd/MM/yyyy');

        const metadata = {
          documentNumber: currentDocumentNumber,
          documentId: getDocumentId({
            documentNumber: currentDocumentNumber,
            domain: 'R',
            subDomain: 'C',
            genre: 'Z',
          }),
          title,
          author: item.authorName || '',
          sourceType: 'web',
          sourceURL: href,
          language: 'Việt',
          period: '21',
          publishedTime: fmtDate || '',
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
          continue;
        }

        logger.info(`Fetched: ${title} - ${href}`);

        currentDocumentNumber += 1;

        metadataList.push(parsedMetadata.data);
      }
    }
  }

  return uniqBy(metadataList, (item) => item.sourceURL);
};
