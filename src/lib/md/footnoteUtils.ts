import { type Footnote } from '@/lib/crawler/schema';

// NOTE: Footnote label can be any alphanumeric string wrapped in square
// brackets. E.g. [1], [note], \\[1] etc.
export const reFootnote = /\\?\\?\[(?<label>[a-zA-Z0-9@]+)\]/gm;

const defaultFormatFootnoteLabel = (label: string) => {
  // NOTE: Default format is to wrap the label in square brackets
  return `[${label}]`;
};

const injectFootnote = <
  T extends Omit<Footnote, 'text'> = Omit<Footnote, 'text'>,
>(
  text: string,
  footnotes: T[],
  formatLabel: (label: string) => string = defaultFormatFootnoteLabel,
): string => {
  // NOTE: Sort the footnotes in descending order so when we add footnote
  // content, the position of the next footnote will not be affected
  const reversedFootnotes = footnotes.sort((a, b) => b.position - a.position);

  let str = text;

  reversedFootnotes.forEach((note) => {
    const newLabel = formatLabel(note.label);

    if (note.position > str.length) {
      str += newLabel;
    } else {
      str =
        str.slice(0, note.position) +
        newLabel +
        str.slice(note.position, str.length);
    }
  });

  return str;
};

const defaultFootnoteLabelSelector = (match: RegExpExecArray) => {
  // NOTE: Default label selector is to return the named group 'label'
  return match.groups?.label ?? match[0];
};

const extractFootnote = (
  text: string,
  labelRegex: RegExp = reFootnote,
  labelSelector: (
    match: RegExpExecArray,
  ) => string = defaultFootnoteLabelSelector,
): Omit<Footnote, 'text'>[] => {
  const matches = text.matchAll(labelRegex);

  return [...matches]
    .map((matchVal, idx, arr) => {
      if (idx === 0) {
        return {
          position: matchVal.index,
          label: labelSelector(matchVal),
        };
      }

      let previousLength = 0;
      // NOTE: We want the whole string match so get the zero index
      const previousMatch = arr.slice(0, idx).map((match) => match['0']);
      // eslint-disable-next-line no-restricted-syntax
      for (const match of previousMatch) {
        previousLength += match.length;
      }

      return {
        // NOTE: We minus previousLength to get the correct position because the
        // current match also includes the previous matches
        position: matchVal.index - previousLength,
        label: labelSelector(matchVal),
      };
    })
    .filter((note) => note.label.trim().length > 0);
};

const removeAllFootnote = (text: string, labelRegex: RegExp = reFootnote) => {
  return text.replaceAll(labelRegex, '');
};

export {
  injectFootnote,
  extractFootnote,
  removeAllFootnote,
  defaultFormatFootnoteLabel,
  defaultFootnoteLabelSelector,
};
