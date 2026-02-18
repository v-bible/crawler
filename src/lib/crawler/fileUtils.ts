import { createReadStream, mkdirSync, readdirSync, writeFileSync } from 'fs';
import path, { dirname } from 'path';
import { type ParserOptionsArgs, parseStream } from 'fast-csv';
import { getChapterId, getDocumentId } from '@/lib/crawler/getId';
import {
  type ChapterParams,
  type GenreParams,
  type MetadataRowCSV,
} from '@/lib/crawler/schema';
import { logger } from '@/logger/logger';

export type GetDefaultDocumentPathFunction = (
  params: ChapterParams & {
    extension: string;
    documentTitle?: string;
    suffix?: string;
  },
) => string;

const getDefaultDocumentPath: GetDefaultDocumentPathFunction = (params) => {
  const documentId = getDocumentId(params);

  let documentFolderPath = `${params.genre}/${documentId}`;

  if (params.documentTitle) {
    const sanitizedTitle = params.documentTitle.replace(/[/\\?%*:|"<>]/g, '_');
    documentFolderPath += ` (${sanitizedTitle})`;
  }

  return `${documentFolderPath}/${getChapterId(params)}${
    params.suffix ? `_${params.suffix}` : ''
  }.${params.extension}`;
};

const writeChapterContent = ({
  getFileName = getDefaultDocumentPath,
  params,
  baseDir,
  content,
  extension,
  documentTitle,
}: {
  params: ChapterParams;
  baseDir: string;
  content: string;
  extension: string;
  documentTitle?: string;
  getFileName?: GetDefaultDocumentPathFunction;
}) => {
  // NOTE: We write to genre dir directly instead of
  // baseDir/domain/subDomain/genre to reduce complexity
  const fileName = `${baseDir}/${getFileName({
    ...params,
    documentTitle,
    extension,
  })}`;

  const documentFolderPath = dirname(fileName);

  try {
    mkdirSync(documentFolderPath, { recursive: true });
  } catch (error) {
    logger.error(`Error creating folder ${documentFolderPath}:`, error);
  }

  try {
    writeFileSync(fileName, content, 'utf8');
    logger.info(`File written successfully: ${fileName}`);
  } catch (error) {
    logger.error(`Error writing file ${fileName}:`, error);
  }
};

const writeChapterContentBuffer = ({
  getFileName = getDefaultDocumentPath,
  params,
  baseDir,
  content,
  extension,
  documentTitle,
}: {
  params: ChapterParams;
  baseDir: string;
  content: Buffer;
  extension: string;
  documentTitle?: string;
  getFileName?: GetDefaultDocumentPathFunction;
}) => {
  // NOTE: We write to genre dir directly instead of
  // baseDir/domain/subDomain/genre to reduce complexity
  const fileName = `${baseDir}/${getFileName({
    ...params,
    documentTitle,
    extension,
  })}`;

  const documentFolderPath = dirname(fileName);

  try {
    mkdirSync(documentFolderPath, { recursive: true });
  } catch (error) {
    logger.error(`Error creating folder ${documentFolderPath}:`, error);
  }

  try {
    writeFileSync(fileName, content);
    logger.info(`File written successfully: ${fileName}`);
  } catch (error) {
    logger.error(`Error writing file ${fileName}:`, error);
  }
};

const readCsvFileStream = <T extends MetadataRowCSV>(
  filePath: string,
  options?: Partial<ParserOptionsArgs>,
) => {
  const defaultOptions = {
    headers: true,
  } satisfies Partial<ParserOptionsArgs>;

  const parserOptions = { ...defaultOptions, ...options };

  const stream = createReadStream(filePath, 'utf8');

  return parseStream<T, T>(stream, parserOptions);
};

const walkDirectoryByGenre = (
  baseDir: string,
  genre: GenreParams['genre'],
): string[] => {
  const genreDir = path.join(baseDir, genre);

  return readdirSync(genreDir, {
    encoding: 'utf8',
    recursive: true,
    withFileTypes: true,
  })
    .filter((dirent) => dirent.isFile())
    .map((dirent) => path.join(dirent.parentPath, dirent.name));
};

export {
  getDefaultDocumentPath,
  writeChapterContent,
  writeChapterContentBuffer,
  readCsvFileStream,
  walkDirectoryByGenre,
};
