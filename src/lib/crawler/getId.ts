import {
  type ChapterParams,
  type DocumentParams,
  type GenreParams,
  IdParamsSchema,
  type PageParams,
  type SentenceParams,
} from '@/lib/crawler/schema';

const reSentenceId =
  /^(?<domain>[A-Z])(?<subDomain>[A-Z])(?<genre>[A-Z])_(?<documentNumber>0[0-9]{2}|[1-9][0-9]{2})(?:\.(?<chapterNumber>0[0-9]{2}|[1-9][0-9]{2})(?:\.(?<pageNumber>0[0-9]{2}|[1-9][0-9]{2})(?:\.(?<sentenceNumber>0[1-9]|[1-9][0-9]))?)?)?$/;

// NOTE: Base prefix format: DSG
const getBasePrefix = (params: GenreParams) => {
  IdParamsSchema.omit({
    documentNumber: true,
    chapterNumber: true,
    pageNumber: true,
    sentenceNumber: true,
  }).parse(params);

  return (
    params.domain.toUpperCase() +
    params.subDomain.toUpperCase() +
    params.genre.toUpperCase()
  );
};

// NOTE: Document ID format: DSG_fff
const getDocumentId = (params: DocumentParams) => {
  IdParamsSchema.omit({
    chapterNumber: true,
    pageNumber: true,
    sentenceNumber: true,
  }).parse(params);

  return `${getBasePrefix(params)}_${params.documentNumber.toString().padStart(3, '0')}`;
};

// NOTE: Document chapter ID format: DSG_fff.ccc
const getChapterId = (
  params: Pick<
    ChapterParams,
    'domain' | 'subDomain' | 'genre' | 'documentNumber' | 'chapterNumber'
  >,
) => {
  IdParamsSchema.omit({
    pageNumber: true,
    sentenceNumber: true,
  }).parse(params);

  return `${getDocumentId(params)}.${params.chapterNumber.toString().padStart(3, '0')}`;
};

// NOTE: Document file ID format: DSG_fff.ccc.ppp
const getPageId = (params: PageParams) => {
  IdParamsSchema.omit({
    sentenceNumber: true,
  }).parse(params);

  return `${getChapterId(params)}.${params.pageNumber.toString().padStart(3, '0')}`;
};

// NOTE: Document sentence ID format: DSG_fff.ccc.ppp.ss
const getSentenceId = (params: SentenceParams) => {
  IdParamsSchema.parse(params);

  return `${getPageId(params)}.${params.sentenceNumber.toString().padStart(2, '0')}`;
};

const parseId = (id: string) => {
  const match = id.match(reSentenceId);
  if (!match || !match.groups) return null;

  const {
    domain,
    subDomain,
    genre,
    documentNumber,
    chapterNumber,
    pageNumber,
    sentenceNumber,
  } = match.groups;

  const parse = IdParamsSchema.partial().parse({
    domain: domain?.toUpperCase(),
    subDomain: subDomain?.toUpperCase(),
    genre: genre?.toUpperCase(),
    documentNumber: documentNumber ? parseInt(documentNumber, 10) : undefined,
    chapterNumber: chapterNumber ? parseInt(chapterNumber, 10) : undefined,
    pageNumber: pageNumber ? parseInt(pageNumber, 10) : undefined,
    sentenceNumber: sentenceNumber ? parseInt(sentenceNumber, 10) : undefined,
  });

  return {
    // eslint-disable-next-line no-nested-ternary
    level: sentenceNumber
      ? 'sentence'
      : // eslint-disable-next-line no-nested-ternary
        pageNumber
        ? 'page'
        : chapterNumber
          ? 'chapter'
          : 'document',
    ...parse,
  };
};

export {
  getBasePrefix,
  getDocumentId,
  getChapterId,
  getPageId,
  getSentenceId,
  parseId,
};
