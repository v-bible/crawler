import z from 'zod/v4';
import { readCsvFileStream } from '@/lib/crawler/fileUtils';
import {
  type Metadata,
  type MetadataOutput,
  MetadataRowCSVSchema,
} from '@/lib/crawler/schema';
import { mapMetadataRowCSVToMetadata } from '@/lib/crawler/schemaMapping';
import { logger } from '@/logger/logger';

export const getMetadataFromCSV = async (metadataFilePath: string) => {
  return new Promise<Metadata[]>((resolve, reject) => {
    const metadataList: MetadataOutput[] = [];

    const tsvStream = readCsvFileStream(metadataFilePath, {
      delimiter: '\t',
      // NOTE: Avoid quote conflicts in TSV files
      quote: '',
    });

    tsvStream.on('data', (row: string) => {
      const parseRes = MetadataRowCSVSchema.safeParse(row);

      if (!parseRes.success) {
        logger.error('Error parsing row:', {
          row,
          error: z.prettifyError(parseRes.error),
        });
        return;
      }

      const metadataCSVRow = parseRes.data;

      const parsedMetadata = mapMetadataRowCSVToMetadata(metadataCSVRow);

      metadataList.push(parsedMetadata);
    });

    tsvStream.on('end', () => {
      resolve(metadataList);
    });

    tsvStream.on('error', (error) => {
      reject(error);
    });
  });
};
