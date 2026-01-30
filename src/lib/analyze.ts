/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { DEFAULT_OUTPUT_FILE_DIR } from '@/constants';
import { ChapterTreeSchema } from '@/lib/crawler/treeSchema';

type NerLabelCounts = Record<string, number>;

interface FileStats {
  fileName: string;
  genre: string;
  pageCount: number;
  sentenceCount: number;
  totalWords: number;
  nerEntityCount: number;
  nerLabelCounts: NerLabelCounts;
}

interface AggregatedStats {
  totalFiles: number;
  totalPages: number;
  totalSentences: number;
  totalWords: number;
  bibleFiles: number;
  biblePages: number;
  bibleSentences: number;
  bibleWords: number;
  totalNerEntities: number;
  bibleNerEntities: number;
  nerLabelCounts: NerLabelCounts;
  bibleNerLabelCounts: NerLabelCounts;
}

const analyzeFile = (filePath: string, genre: string): FileStats => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = ChapterTreeSchema.parse(JSON.parse(raw));
  const { pages, annotations } = data.root.file.sect;

  let sentenceCount = 0;
  let totalWords = 0;
  let nerEntityCount = 0;
  const nerLabelCounts: NerLabelCounts = {};

  // Count sentences and words
  // eslint-disable-next-line no-restricted-syntax
  for (const page of pages) {
    // eslint-disable-next-line no-restricted-syntax
    for (const sentence of page.sentences) {
      sentenceCount += 1;

      if (sentence.type === 'single') {
        const wordCount = sentence.text.split(/\s+/).filter(Boolean).length;
        totalWords += wordCount;
      }
    }
  }

  // Count NER entities and labels
  if (annotations) {
    // eslint-disable-next-line no-restricted-syntax
    for (const annotation of annotations) {
      nerEntityCount += 1;

      // Count each label for this entity
      // eslint-disable-next-line no-restricted-syntax
      for (const label of annotation.labels) {
        nerLabelCounts[label] = (nerLabelCounts[label] || 0) + 1;
      }
    }
  }

  return {
    fileName: path.basename(filePath),
    genre,
    pageCount: pages.length,
    sentenceCount,
    totalWords,
    nerEntityCount,
    nerLabelCounts,
  };
};

const aggregateStats = (filesStats: FileStats[]): AggregatedStats => {
  return filesStats.reduce(
    (acc, file) => {
      acc.totalFiles += 1;
      acc.totalPages += file.pageCount;
      acc.totalSentences += file.sentenceCount;
      acc.totalWords += file.totalWords;
      acc.totalNerEntities += file.nerEntityCount;

      // Aggregate NER label counts
      // eslint-disable-next-line no-restricted-syntax
      for (const [label, count] of Object.entries(file.nerLabelCounts)) {
        acc.nerLabelCounts[label] = (acc.nerLabelCounts[label] || 0) + count;
      }

      // Check if this is Bible-related data (genres N or O)
      if (file.genre === 'N' || file.genre === 'O') {
        acc.bibleFiles += 1;
        acc.biblePages += file.pageCount;
        acc.bibleSentences += file.sentenceCount;
        acc.bibleWords += file.totalWords;
        acc.bibleNerEntities += file.nerEntityCount;

        // Aggregate Bible NER label counts
        // eslint-disable-next-line no-restricted-syntax
        for (const [label, count] of Object.entries(file.nerLabelCounts)) {
          acc.bibleNerLabelCounts[label] =
            (acc.bibleNerLabelCounts[label] || 0) + count;
        }
      }

      return acc;
    },
    {
      totalFiles: 0,
      totalPages: 0,
      totalSentences: 0,
      totalWords: 0,
      bibleFiles: 0,
      biblePages: 0,
      bibleSentences: 0,
      bibleWords: 0,
      totalNerEntities: 0,
      bibleNerEntities: 0,
      nerLabelCounts: {} as NerLabelCounts,
      bibleNerLabelCounts: {} as NerLabelCounts,
    },
  );
};

const printStats = (stats: AggregatedStats): void => {
  console.log('\nAGGREGATED CORPUS STATS');
  console.log('----------------------------');
  console.log(`Total files: ${stats.totalFiles}`);
  console.log(`Total pages: ${stats.totalPages}`);
  console.log(`Total sentences: ${stats.totalSentences}`);
  console.log(`Total words: ${stats.totalWords}`);
  console.log(
    `Avg words per sentence: ${(stats.totalWords / stats.totalSentences).toFixed(2)}`,
  );

  console.log('\nBIBLE DATA STATS (Genres N & O)');
  console.log('-----------------------------------');
  console.log(`Bible files: ${stats.bibleFiles}`);
  console.log(`Bible pages: ${stats.biblePages}`);
  console.log(`Bible sentences: ${stats.bibleSentences}`);
  console.log(`Bible words: ${stats.bibleWords}`);
  if (stats.bibleSentences > 0) {
    console.log(
      `Avg words per Bible sentence: ${(stats.bibleWords / stats.bibleSentences).toFixed(2)}`,
    );
  }

  console.log('\nBIBLE vs TOTAL PERCENTAGE');
  console.log('-----------------------------');
  console.log(
    `Bible files: ${((stats.bibleFiles / stats.totalFiles) * 100).toFixed(1)}%`,
  );
  console.log(
    `Bible pages: ${((stats.biblePages / stats.totalPages) * 100).toFixed(1)}%`,
  );
  console.log(
    `Bible sentences: ${((stats.bibleSentences / stats.totalSentences) * 100).toFixed(1)}%`,
  );
  console.log(
    `Bible words: ${((stats.bibleWords / stats.totalWords) * 100).toFixed(1)}%`,
  );

  console.log('\nNER ENTITY STATS');
  console.log('--------------------');
  console.log(`Total NER entities: ${stats.totalNerEntities}`);
  console.log(`Bible NER entities: ${stats.bibleNerEntities}`);
  if (stats.totalNerEntities > 0) {
    console.log(
      `Bible NER percentage: ${((stats.bibleNerEntities / stats.totalNerEntities) * 100).toFixed(1)}%`,
    );
  }

  console.log('\nNER LABELS BREAKDOWN');
  console.log('-------------------------');
  const sortedLabels = Object.entries(stats.nerLabelCounts).sort(
    ([, a], [, b]) => b - a,
  );

  // eslint-disable-next-line no-restricted-syntax
  for (const [label, count] of sortedLabels) {
    const bibleCount = stats.bibleNerLabelCounts[label] || 0;
    const percentage =
      stats.totalNerEntities > 0
        ? ((count / stats.totalNerEntities) * 100).toFixed(1)
        : '0.0';
    const biblePercentage =
      count > 0 ? ((bibleCount / count) * 100).toFixed(1) : '0.0';
    console.log(
      `${label}: ${count} (${percentage}% of total, ${biblePercentage}% from Bible)`,
    );
  }
};

const main = (): void => {
  const folder = DEFAULT_OUTPUT_FILE_DIR; // or your folder path

  const files = fs
    .readdirSync(folder)
    .map((genreFolder) =>
      fs
        .readdirSync(path.join(folder, genreFolder))
        .flatMap((documentFolder) =>
          path.join(folder, genreFolder, documentFolder),
        )
        .flatMap((documentFolder) =>
          fs
            .readdirSync(documentFolder)
            .filter((file) => file.endsWith('.json'))
            .map((file) => ({
              filePath: path.join(documentFolder, file),
              genre: genreFolder,
            })),
        ),
    )
    .flat();

  const statsPerFile = files.map(({ filePath, genre }) => {
    console.log(`Processing: ${filePath}`);
    return analyzeFile(filePath, genre);
  });

  const aggregated = aggregateStats(statsPerFile);
  printStats(aggregated);
};

main();
