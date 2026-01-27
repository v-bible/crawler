/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { accessSync, readFileSync } from 'fs';
import path, { basename } from 'path';
import { updateAnnotations } from '@/lib/ner/nerUtils';
import { NerDataSchema, type SentenceEntityAnnotation } from '@/lib/ner/schema';
import { walkDirectoryByGenre, writeChapterContent } from '@/lib/nlp/fileUtils';
import { parseId } from '@/lib/nlp/getId';
import { type GenreParams } from '@/lib/nlp/schema';
import { ChapterTreeSchema } from '@/lib/nlp/treeSchema';
import {
  generateDataTreeWithAnnotation,
  generateJsonTree,
  generateXmlTree,
} from '@/lib/nlp/treeUtils';
import { logger } from '@/logger/logger';
import { corpusDir, taskDir } from '@/ner-processing/constant';

const main = async () => {
  const currentGenre = 'N' satisfies GenreParams['genre'];

  // NOTE: Get all json files from dir.
  const files = walkDirectoryByGenre(corpusDir, currentGenre);

  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  for await (const corpusFilePath of jsonFiles) {
    const taskFile = path.join(taskDir, currentGenre, basename(corpusFilePath));

    // Check if annotation file exists
    try {
      accessSync(taskFile);
    } catch {
      continue;
    }

    const taskFileData = JSON.parse(readFileSync(taskFile, 'utf-8'));

    const taskParse = NerDataSchema.array().safeParse(taskFileData);

    if (!taskParse.success) {
      logger.error(
        `Invalid annotation data in file ${taskFile}: ${taskParse.error.message}`,
      );
      continue;
    }

    const treeFileData = JSON.parse(readFileSync(corpusFilePath, 'utf-8'));

    const treeParse = ChapterTreeSchema.safeParse(treeFileData);

    if (!treeParse.success) {
      logger.error(
        `Invalid data in file ${corpusFilePath}: ${treeParse.error.message}`,
      );
      continue;
    }

    const { data: tree } = treeParse;
    const { data: tasks } = taskParse;

    const mapSentenceEntityAnnotation = tasks.flatMap((task) => {
      return (
        task.annotations?.flatMap((annotation) => {
          return annotation.result.map((res) => ({
            text: res.value.text,
            start: res.value.start,
            end: res.value.end,
            labels: res.value.labels,
            sentenceId: task.data.sentenceId,
            languageCode: task.data.languageCode,
            sentenceType: task.data.sentenceType,
          }));
        }) || []
      );
    }) satisfies SentenceEntityAnnotation[];

    if (mapSentenceEntityAnnotation.length === 0) {
      continue;
    }

    const parseParams = parseId(tree.root.file.id);

    if (!parseParams) {
      logger.error(`Invalid file ID: ${tree.root.file.id}`);
      continue;
    }

    const chapterParams = {
      chapterName: tree.root.file.sect.name,
      chapterNumber: tree.root.file.sect.number,
      documentNumber: tree.root.file.meta.documentNumber,
      domain: parseParams.domain!,
      genre: tree.root.file.meta.genre.code,
      subDomain: parseParams.subDomain!,
    };

    const newTree = updateAnnotations(tree, mapSentenceEntityAnnotation);

    // NOTE: We don't need to wrap NER label in sentence for json tree
    const { content: jsonTree } = generateJsonTree(newTree);

    const treeWithAnnotation = generateDataTreeWithAnnotation({
      chapterParams,
      metadata: newTree.root.file.meta,
      pages: newTree.root.file.sect.pages,
      footnotes: newTree.root.file.sect?.footnotes || [],
      headings: newTree.root.file.sect?.headings || [],
      annotations: mapSentenceEntityAnnotation,
    });

    const { content: xmlTree } = generateXmlTree(treeWithAnnotation);

    writeChapterContent({
      params: chapterParams,
      baseDir: corpusDir,
      content: jsonTree,
      extension: 'json',
      documentTitle: newTree.root.file.meta.title,
    });

    writeChapterContent({
      params: chapterParams,
      baseDir: corpusDir,
      content: xmlTree,
      extension: 'xml',
      documentTitle: newTree.root.file.meta.title,
    });

    logger.info(`Updated annotations for ${newTree.root.file.meta.documentId}`);
  }
};

main();
