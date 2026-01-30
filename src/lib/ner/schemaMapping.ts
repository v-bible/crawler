import { type ChapterTreeOutput } from '@/lib/crawler/treeSchema';
import { type NerData, type SentenceEntityAnnotation } from '@/lib/ner/schema';

const mapAnnotationToNerResult = (annotation: SentenceEntityAnnotation) => {
  return {
    value: {
      start: annotation.start,
      end: annotation.end,
      text: annotation.text,
      labels: annotation.labels,
    },
    // NOTE: This is hard-coded and should match with label studio template
    // from README.md, especially the "to_name" key
    from_name: 'label',
    to_name: 'text',
    type: 'labels',
  };
};

const mapTreeToNerData = (chapterTree: ChapterTreeOutput): NerData[] => {
  const annotations = chapterTree?.root.file.sect.annotations || [];

  return chapterTree.root.file.sect.pages
    .flatMap((page) => page.sentences)
    .map((sentence) => {
      if (sentence.type === 'single') {
        const sentenceAnnotations = annotations
          ?.filter((annotation) => annotation.sentenceId === sentence.id)
          .map(mapAnnotationToNerResult);

        return {
          data: {
            text: sentence.text,
            documentId: chapterTree.root.file.id,
            chapterId: chapterTree.root.file.sect.id,
            sentenceId: sentence.id,
            sentenceType: sentence.type,
            languageCode: '',
            title: chapterTree.root.file.meta.title,
            genreCode: chapterTree.root.file.meta.genre.code,
          },
          // NOTE: DO NOT include empty annotations array because this will be
          // imported as ground truth data in Label Studio
          ...(sentenceAnnotations.length > 0 && {
            annotations: [
              {
                result: sentenceAnnotations,
              },
            ],
          }),
        } satisfies NerData;
      }

      return sentence.array.map((s) => {
        const sentenceAnnotations = annotations
          ?.filter((annotation) => annotation.sentenceId === sentence.id)
          .map(mapAnnotationToNerResult);

        return {
          data: {
            text: s.text,
            documentId: chapterTree.root.file.id,
            chapterId: chapterTree.root.file.sect.id,
            sentenceId: sentence.id,
            sentenceType: sentence.type,
            languageCode: s.languageCode,
            title: chapterTree.root.file.meta.title,
            genreCode: chapterTree.root.file.meta.genre.code,
          },
          // NOTE: DO NOT include empty annotations array because this will be
          // imported as ground truth data in Label Studio
          ...(sentenceAnnotations.length > 0 && {
            annotations: [
              {
                result: sentenceAnnotations,
              },
            ],
          }),
        } satisfies NerData;
      });
    })
    .flat();
};

export { mapTreeToNerData };
