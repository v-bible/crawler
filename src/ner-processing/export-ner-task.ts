/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { DEFAULT_TASK_DIR } from '@/constants';
import { NerDataSchema } from '@/lib/ner/schema';
import { logger } from '@/logger/logger';

import 'dotenv/config';

const main = async () => {
  const BASE_URL = process.env.LABEL_STUDIO_URL || 'http://localhost:8080';
  const LABEL_STUDIO_LEGACY_TOKEN = process.env.LABEL_STUDIO_LEGACY_TOKEN || '';
  const LABEL_STUDIO_PROJECT_TITLE =
    process.env.LABEL_STUDIO_PROJECT_TITLE || 'v-bible';

  const allProjects = await (
    await fetch(`${BASE_URL}/api/projects/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
      },
    })
  ).json();

  const projectInfo = allProjects?.results?.find(
    (project: Record<string, unknown>) =>
      project.title === LABEL_STUDIO_PROJECT_TITLE,
  );

  const snapShotBody = {
    task_filter_options: {
      // NOTE: Only include tasks with annotations
      annotated: 'only',
    },
  };

  const snapShot = await (
    await fetch(`${BASE_URL}/api/projects/${projectInfo.id}/exports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
      },
      body: JSON.stringify(snapShotBody),
    })
  ).json();

  const snapShotDownloadQuery = new URLSearchParams({
    queryType: 'JSON',
  });

  const snapShotData = await (
    await fetch(
      `${BASE_URL}/api/projects/${projectInfo.id}/exports/${
        snapShot.id
      }/download?${snapShotDownloadQuery.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
        },
      },
    )
  ).json();

  for (const data of snapShotData) {
    const nerDataParse = NerDataSchema.safeParse({
      data: data.data,
      annotations: data.annotations,
    });

    if (!nerDataParse.success) {
      logger.error(
        `Invalid NER data in snapshot: ${nerDataParse.error.message}`,
      );
      continue;
    }

    const nerData = nerDataParse.data;

    const taskFilePath = path.join(
      DEFAULT_TASK_DIR,
      nerData.data.genreCode,
      `${nerData.data.chapterId}.json`,
    );

    // Ensure the directory exists
    const dir = path.dirname(taskFilePath);
    mkdirSync(dir, { recursive: true });

    try {
      // NOTE: Append annotations
      const fileData = readFileSync(taskFilePath, 'utf-8');

      const taskData = JSON.parse(fileData) || [];

      const taskParse = NerDataSchema.array().safeParse(taskData);

      if (!taskParse.success) {
        logger.error(
          `Invalid task data in file ${taskFilePath}: ${taskParse.error.message}`,
        );
        continue;
      }

      const currentTask = taskParse.data.findIndex(
        (task) => task.data.sentenceId === nerData.data.sentenceId,
      );

      if (currentTask !== -1) {
        // Update existing task
        taskData[currentTask].annotations = nerData.annotations;
      } else {
        // Add new task
        taskData.push(nerData);
      }

      // Write updated tasks back to file
      writeFileSync(taskFilePath, JSON.stringify(taskData, null, 2), 'utf-8');

      logger.info(
        `Wrote annotation data to ${taskFilePath} for sentenceId: ${nerData.data.sentenceId}`,
      );
    } catch (error) {
      logger.error(
        `Failed to write annotation data to ${taskFilePath}: ${error}`,
      );

      continue;
    }
  }

  // NOTE: Delete export snapshot
  await fetch(
    `${BASE_URL}/api/projects/${projectInfo.id}/exports/${snapShot.id}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${LABEL_STUDIO_LEGACY_TOKEN}`,
      },
    },
  );
};

main();
