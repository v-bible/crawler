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

interface GenreStats {
  files: number;
  pages: number;
  sentences: number;
  words: number;
  nerEntities: number;
  nerLabelCounts: NerLabelCounts;
}

interface AggregatedStats {
  totalFiles: number;
  totalPages: number;
  totalSentences: number;
  totalWords: number;
  totalNerEntities: number;
  nerLabelCounts: NerLabelCounts;
  genreStats: Record<string, GenreStats>;
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

      // Initialize genre stats if not exists
      if (!acc.genreStats[file.genre]) {
        acc.genreStats[file.genre] = {
          files: 0,
          pages: 0,
          sentences: 0,
          words: 0,
          nerEntities: 0,
          nerLabelCounts: {},
        };
      }

      // Aggregate per-genre stats
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const genreStat = acc.genreStats[file.genre]!;
      genreStat.files += 1;
      genreStat.pages += file.pageCount;
      genreStat.sentences += file.sentenceCount;
      genreStat.words += file.totalWords;
      genreStat.nerEntities += file.nerEntityCount;

      // Aggregate genre-specific NER label counts
      // eslint-disable-next-line no-restricted-syntax
      for (const [label, count] of Object.entries(file.nerLabelCounts)) {
        genreStat.nerLabelCounts[label] =
          (genreStat.nerLabelCounts[label] || 0) + count;
      }

      return acc;
    },
    {
      totalFiles: 0,
      totalPages: 0,
      totalSentences: 0,
      totalWords: 0,
      totalNerEntities: 0,
      nerLabelCounts: {} as NerLabelCounts,
      genreStats: {} as Record<string, GenreStats>,
    },
  );
};

const printStats = (stats: AggregatedStats): void => {
  console.log('\nOVERALL CORPUS STATS');
  console.log('==============================');
  console.log(`Total files: ${stats.totalFiles}`);
  console.log(`Total pages: ${stats.totalPages}`);
  console.log(`Total sentences: ${stats.totalSentences}`);
  console.log(`Total words: ${stats.totalWords}`);
  console.log(`Total NER entities: ${stats.totalNerEntities}`);
  console.log(
    `Avg words per sentence: ${(stats.totalWords / stats.totalSentences).toFixed(2)}`,
  );

  // Sort genres alphabetically
  const sortedGenres = Object.keys(stats.genreStats).sort();

  console.log('\n\nSTATS BY GENRE');
  console.log('==============================');

  // eslint-disable-next-line no-restricted-syntax
  for (const genre of sortedGenres) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const genreStat = stats.genreStats[genre]!;
    const filesPercent = ((genreStat.files / stats.totalFiles) * 100).toFixed(
      1,
    );
    const pagesPercent = ((genreStat.pages / stats.totalPages) * 100).toFixed(
      1,
    );
    const sentencesPercent = (
      (genreStat.sentences / stats.totalSentences) *
      100
    ).toFixed(1);
    const wordsPercent = ((genreStat.words / stats.totalWords) * 100).toFixed(
      1,
    );
    const nerPercent =
      stats.totalNerEntities > 0
        ? ((genreStat.nerEntities / stats.totalNerEntities) * 100).toFixed(1)
        : '0.0';
    const avgWords =
      genreStat.sentences > 0
        ? (genreStat.words / genreStat.sentences).toFixed(2)
        : '0.00';

    console.log(`\nGenre: ${genre}`);
    console.log('------------------------------');
    console.log(`Files: ${genreStat.files} (${filesPercent}% of total)`);
    console.log(`Pages: ${genreStat.pages} (${pagesPercent}% of total)`);
    console.log(
      `Sentences: ${genreStat.sentences} (${sentencesPercent}% of total)`,
    );
    console.log(`Words: ${genreStat.words} (${wordsPercent}% of total)`);
    console.log(
      `NER entities: ${genreStat.nerEntities} (${nerPercent}% of total)`,
    );
    console.log(`Avg words per sentence: ${avgWords}`);

    // Show top NER labels for this genre
    const sortedLabels = Object.entries(genreStat.nerLabelCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    if (sortedLabels.length > 0) {
      console.log('  Top NER labels:');
      // eslint-disable-next-line no-restricted-syntax
      for (const [label, count] of sortedLabels) {
        const labelPercent =
          genreStat.nerEntities > 0
            ? ((count / genreStat.nerEntities) * 100).toFixed(1)
            : '0.0';
        console.log(`    ${label}: ${count} (${labelPercent}%)`);
      }
    }
  }

  console.log('\n\nOVERALL NER LABELS BREAKDOWN');
  console.log('==============================');
  const sortedLabels = Object.entries(stats.nerLabelCounts).sort(
    ([, a], [, b]) => b - a,
  );

  // eslint-disable-next-line no-restricted-syntax
  for (const [label, count] of sortedLabels) {
    const percentage =
      stats.totalNerEntities > 0
        ? ((count / stats.totalNerEntities) * 100).toFixed(1)
        : '0.0';
    console.log(`${label}: ${count} (${percentage}% of total)`);
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
