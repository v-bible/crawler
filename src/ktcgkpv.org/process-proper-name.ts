/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { readFileSync } from 'fs';
import { updateAnnotations } from '@/lib/ner/nerUtils';
import { type SentenceEntityAnnotation } from '@/lib/ner/schema';
import { walkDirectoryByGenre, writeChapterContent } from '@/lib/nlp/fileUtils';
import { parseId } from '@/lib/nlp/getId';
import { type Footnote, type GenreParams } from '@/lib/nlp/schema';
import { ChapterTreeSchema } from '@/lib/nlp/treeSchema';
import {
  generateDataTreeWithAnnotation,
  generateJsonTree,
  generateXmlTree,
} from '@/lib/nlp/treeUtils';
import { logger } from '@/logger/logger';
import { corpusDir } from '@/ner-processing/constant';

// Helper function to extract names from footnote text
const extractNamesFromFootnote = (footnoteText: string): string[] => {
  const names: string[] = [];

  // Split by | to get different language sections
  for (const section of footnoteText.split('|')) {
    const match = section.split(':').at(1)?.trim();

    if (match) {
      const name = match
        .split('--')
        .at(0)
        ?.replace(/\d/g, '') // Remove digits
        .replace(/\([^)]+\)/g, '') // Remove parentheses content
        .trim();

      if (name) {
        names.push(name);
      }
    }
  }

  return names;
};

export const findNameMatches = (text: string, footnotes: Footnote[]) => {
  const matches: Array<{ text: string; start: number; end: number }> = [];

  for (const footnote of footnotes) {
    // Extract names from footnote text
    const footnoteNames = extractNamesFromFootnote(footnote.text);

    for (const name of footnoteNames) {
      // Calculate position: footnote position minus name length
      const end = footnote.position;
      const start = end - name.length;

      // Verify the name actually exists at this position in the text
      const textAtPosition = text.substring(start, end);
      if (textAtPosition === name) {
        matches.push({ text: name, start, end });
      }
    }
  }

  return matches.sort((a, b) => a.start - b.start);
};

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

    const treeData = treeParse.data;

    const { footnotes = [] } = treeData.root.file.sect;

    const newAnnotations = treeData.root.file.sect.pages.flatMap((page) => {
      return page.sentences
        .map((sentence) => {
          if (sentence.type === 'single') {
            const { text } = sentence;

            const matchedNames = findNameMatches(text, footnotes);

            return matchedNames.map((match) => {
              return {
                text: match.text,
                start: match.start,
                end: match.end,
                // NOTE: Currently we hardcode the label to 'PER' for proper names
                labels: ['PER'],
                sentenceId: sentence.id,
                languageCode: '',
                sentenceType: sentence.type,
              } satisfies SentenceEntityAnnotation;
            });
          }

          return sentence.array.flatMap((s) => {
            const { text } = s;

            const matchedNames = findNameMatches(text, footnotes);

            return matchedNames.flatMap((match) => {
              return {
                text: match.text,
                start: match.start,
                end: match.end,
                // NOTE: Currently we hardcode the label to 'PER' for proper names
                labels: ['PER'],
                sentenceId: sentence.id,
                languageCode: s.languageCode,
                sentenceType: sentence.type,
              } satisfies SentenceEntityAnnotation;
            });
          });
        })
        .flat();
    }) satisfies SentenceEntityAnnotation[];

    const parseParams = parseId(treeData.root.file.id);

    if (!parseParams) {
      logger.error(`Invalid file ID: ${treeData.root.file.id}`);
      continue;
    }

    const chapterParams = {
      chapterName: treeData.root.file.sect.name,
      chapterNumber: treeData.root.file.sect.number,
      documentNumber: treeData.root.file.meta.documentNumber,
      domain: parseParams.domain!,
      genre: treeData.root.file.meta.genre.code,
      subDomain: parseParams.subDomain!,
    };

    const newTree = updateAnnotations(treeData, newAnnotations);

    // NOTE: We don't need to wrap NER label in sentence for json tree
    const { content: jsonTree } = generateJsonTree(newTree);

    const treeWithAnnotation = generateDataTreeWithAnnotation({
      chapterParams,
      metadata: newTree.root.file.meta,
      pages: newTree.root.file.sect.pages,
      footnotes: newTree.root.file.sect?.footnotes || [],
      headings: newTree.root.file.sect?.headings || [],
      annotations: newAnnotations,
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
