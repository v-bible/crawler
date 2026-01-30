import Bluebird from '@/lib/bluebird';
import { type GetChaptersFunction } from '@/lib/crawler/crawler';

const getChapters = (({ resourceHref }) => {
  return new Bluebird.Promise(async (resolve) => {
    const bibleChaptersMetadata = (await (
      await fetch(
        'https://huggingface.co/datasets/v-bible/catholic-resources/resolve/main/books/bible/versions/ktcgkpv.org/kt2011/metadata.json',
      )
    ).json()) as Record<string, unknown>[];

    const bookCode = resourceHref.href.split('/').pop();

    const currentBookMeta = bibleChaptersMetadata.find(
      (item) => item.code === bookCode,
    );

    const baseURL = `https://huggingface.co/datasets/v-bible/bible/resolve/main/books/bible/versions/ktcgkpv.org/kt2011/${bookCode}`;

    resolve(
      (currentBookMeta?.chapters as Record<string, unknown>[])?.map(
        (chapter) => {
          return {
            href: `${baseURL}/${chapter.number}/${chapter.number}.json`,
            props: {
              chapterNumber: chapter.number as number,
              mdHref: `${baseURL}/${chapter.number}/${chapter.number}.md`,
            },
          } satisfies Awaited<ReturnType<GetChaptersFunction>>[number];
        },
      ) || [],
    );
  });
}) satisfies GetChaptersFunction;

export { getChapters };
