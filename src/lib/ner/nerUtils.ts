import {
  type ChapterTreeOutput,
  ChapterTreeSchema,
} from '@/lib/crawler/treeSchema';
import { type SentenceEntityAnnotation } from '@/lib/ner/schema';

const updateAnnotations = (
  tree: ChapterTreeOutput,
  annotations: SentenceEntityAnnotation[],
): ChapterTreeOutput => {
  const parsedTree = ChapterTreeSchema.parse(tree);

  return {
    ...parsedTree,
    root: {
      ...parsedTree.root,
      file: {
        ...parsedTree.root.file,
        sect: {
          ...parsedTree.root.file.sect,
          annotations: annotations.length > 0 ? annotations : undefined,
        },
      },
    },
  } satisfies ChapterTreeOutput;
};

const resolveOverlapAnnotation = (
  annotations: SentenceEntityAnnotation[],
  options: {
    overlapKeepRight?: boolean;
  },
) => {
  const { overlapKeepRight = true } = options;

  if (annotations.length <= 1) {
    return annotations;
  }

  // Sort annotations by start position (descending) for processing
  const sortedAnnotations = [...annotations].sort((a, b) => b.start - a.start);
  const additionalAnnotations: SentenceEntityAnnotation[] = [];

  // Process overlaps in a single pass
  for (let i = 1; i < sortedAnnotations.length; i += 1) {
    const current = sortedAnnotations[i]!;
    const prev = sortedAnnotations[i - 1]!;

    // NOTE: Not overlapping case
    if (prev.start >= current.end) {
      // No overlap, continue to next
    } else if (
      // NOTE: Contained case
      prev.start >= current.start &&
      prev.end <= current.end &&
      prev.start < current.end
    ) {
      // Contained case, continue to next
    } else if (
      // NOTE: Overlapping case
      prev.start < current.end &&
      prev.end > current.start
    ) {
      // NOTE: If overlapKeepRight is true then we keep "prev" (as right reversed)
      // annotation, update end of the "current" annotation to the start of
      // the "prev" annotation, and push the new inner annotation of "current"
      // annotation to the array
      if (overlapKeepRight) {
        // NOTE: Add the new inner annotation of "current" annotation
        // NOTE: Add before we modify the "current" annotation
        additionalAnnotations.push({
          ...current,
          start: prev.start,
          end: current.end,
          text: current.text.slice(
            prev.start - current.start,
            current.text.length,
          ),
        });

        // Update current annotation to end before overlap
        sortedAnnotations[i] = {
          ...current,
          end: prev.start,
          text: current.text.slice(0, prev.start - current.start),
        };
      } else {
        // NOTE: If overlapKeepRight is false then we keep "current" annotation,
        // update the start of the "prev" annotation to the end of
        // the "current" annotation, and push the new inner annotation of
        // "prev" annotation to the array

        // NOTE: Add the new inner annotation of "prev" annotation
        // NOTE: Add before we modify the "prev" annotation
        additionalAnnotations.push({
          ...prev,
          start: prev.start,
          end: current.end,
          text: prev.text.slice(0, current.end - prev.start),
        });

        // NOTE: Update prev annotation to start after overlap
        sortedAnnotations[i - 1] = {
          ...prev,
          start: current.end,
          text: prev.text.slice(current.end - prev.start, prev.text.length),
        };
      }
    }
  }

  // NOTE: Return the resolved annotations with additional annotations
  return [...sortedAnnotations, ...additionalAnnotations].sort(
    (a, b) => a.start - b.start,
  );
};

const wrapNERLabel = (
  text: string,
  annotations: SentenceEntityAnnotation[],
): string => {
  if (annotations.length === 0) return text;

  const resolvedAnnotations = resolveOverlapAnnotation(annotations, {
    overlapKeepRight: true,
  });

  // NOTE: We sort resolved annotations reversed so we can wrap
  // annotations without affecting the position of the next annotation and we
  // also sort to get longer annotations first
  const sortedAnnotations = resolvedAnnotations.sort((a, b) => {
    if (a.start !== b.start) {
      return b.start - a.start; // Process from right to left
    }
    // If start positions are the same, process longer annotations first
    const aLength = a.end - a.start;
    const bLength = b.end - b.start;
    return bLength - aLength;
  });

  // Pre-calculate tags to avoid repeated string operations
  const annotationsWithTags = sortedAnnotations.map((annotation) => ({
    ...annotation,
    // NOTE:
    openingTag: `<${annotation.labels[0]!} SENTENCE_ID="${annotation.sentenceId}" SENTENCE_TYPE="${annotation.sentenceType}" LANGUAGE_CODE="${annotation.languageCode}">`,
    closingTag: `</${annotation.labels[0]!}>`,
  }));

  // NOTE: We have sorted the annotations in descending order and longer
  // annotations first
  for (let i = 0; i < annotationsWithTags.length; i += 1) {
    const current = annotationsWithTags[i]!;

    for (let j = i + 1; j < annotationsWithTags.length; j += 1) {
      const next = annotationsWithTags[j]!;

      // Case: (i: 2-10, j: 2-5) - next annotation is contained within current
      if (
        next.start >= current.start &&
        next.end <= current.end &&
        next.start < current.end
      ) {
        next.start += current.openingTag.length;
        next.end += current.openingTag.length;
      }
      // Case: (i: 3-5, j: 2-10) or (i: 7-10, j: 2-10) or (i: 3-5, j: 3-5) -
      // next annotation contains current
      else if (
        next.start <= current.start &&
        next.end >= current.end &&
        next.start < current.end
      ) {
        next.end += current.openingTag.length + current.closingTag.length;
      }
    }
  }

  let result = text;
  annotationsWithTags.forEach((annotation) => {
    result =
      result.slice(0, annotation.start) +
      annotation.openingTag +
      result.slice(annotation.start, annotation.end) +
      annotation.closingTag +
      result.slice(annotation.end);
  });

  return result;
};

export { updateAnnotations, wrapNERLabel, resolveOverlapAnnotation };
