/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { readFileSync } from 'fs';
import { walkDirectoryByGenre } from '@/lib/crawler/fileUtils';
import { type GenreParams } from '@/lib/crawler/schema';
import { NerDataSchema } from '@/lib/ner/schema';
import { logger } from '@/logger/logger';
import { taskDir } from '@/ner-processing/constant';

import 'dotenv/config';

const main = async () => {
  const BASE_URL = process.env.LABEL_STUDIO_URL || 'http://localhost:8080';
  const LABEL_STUDIO_LEGACY_TOKEN = process.env.LABEL_STUDIO_LEGACY_TOKEN || '';
  const LABEL_STUDIO_PROJECT_TITLE =
    process.env.LABEL_STUDIO_PROJECT_TITLE || 'v-bible';

  const currentGenre = 'N' satisfies GenreParams['genre'];

  // NOTE: Get all json files from dir.
  const files = walkDirectoryByGenre(taskDir, currentGenre);

  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  const allProjects = await (
    await fetch(`${BASE_URL}/api/projects/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
      },
    })
  ).json();

  if (allProjects?.status_code === 401) {
    logger.error(
      'Invalid Label Studio legacy token. Please check your environment variables.',
    );
  }

  const projectInfo = allProjects?.results?.find(
    (project: Record<string, unknown>) =>
      project.title === LABEL_STUDIO_PROJECT_TITLE,
  );

  for await (const taskFilePath of jsonFiles) {
    const fileData = JSON.parse(readFileSync(taskFilePath, 'utf-8'));

    const nerParse = NerDataSchema.array().safeParse(fileData);

    if (!nerParse.success) {
      logger.error(
        `Invalid NER data in file ${taskFilePath}: ${nerParse.error.message}`,
      );
      continue;
    }

    await fetch(`${BASE_URL}/api/projects/${projectInfo.id}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
      },
      body: JSON.stringify(nerParse.data),
    });

    logger.info(
      `Imported NER data from ${taskFilePath} to Label Studio project`,
    );
  }
};

main();
