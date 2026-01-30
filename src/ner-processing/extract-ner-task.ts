/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { walkDirectoryByGenre } from '@/lib/crawler/fileUtils';
import { type GenreParams } from '@/lib/crawler/schema';
import { ChapterTreeSchema } from '@/lib/crawler/treeSchema';
import { mapTreeToNerData } from '@/lib/ner/schemaMapping';
import { logger } from '@/logger/logger';
import { corpusDir, taskDir } from '@/ner-processing/constant';

const main = () => {
  const currentGenre = 'N' satisfies GenreParams['genre'];

  // NOTE: Get all json files from dir.
  const files = walkDirectoryByGenre(corpusDir, currentGenre);

  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  // NOTE: Read all json files and extract sentences.
  for (const corpusFilePath of jsonFiles) {
    const fileData = JSON.parse(readFileSync(corpusFilePath, 'utf-8'));

    const treeParse = ChapterTreeSchema.safeParse(fileData);

    if (!treeParse.success) {
      logger.error(
        `Invalid data in file ${corpusFilePath}: ${treeParse.error.message}`,
      );
      continue;
    }

    const nerTasks = mapTreeToNerData(treeParse.data);

    const outputDir = path.join(taskDir, currentGenre);
    mkdirSync(outputDir, { recursive: true });

    // NOTE: Write sentences to output file
    const outputFilePath = path.join(
      taskDir,
      currentGenre,
      `${treeParse.data.root.file.sect.id}.json`,
    );

    writeFileSync(outputFilePath, JSON.stringify(nerTasks, null, 2));

    logger.info(
      `Extracted sentences from ${corpusFilePath} to ${outputFilePath}`,
    );
  }
};

main();
