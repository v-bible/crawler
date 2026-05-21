/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { type GetPageContentFunction } from '@/lib/crawler/crawler';
import { getPageId, getSentenceId } from '@/lib/crawler/getId';
import { type SingleLanguageSentence } from '@/lib/crawler/schema';
import {
  createRongMotamhonBrowserPage,
  getReadmeContentHtml,
  gotoWithRetry,
} from '@/sites/rongmotamhon.net/browserUtils';

const getPageContentVie: GetPageContentFunction = async ({
  resourceHref,
  chapterParams,
}) => {
  const { href } = resourceHref;

  const { browser, context, page } = await createRongMotamhonBrowserPage({
    blockAds: true,
  });

  try {
    await gotoWithRetry(page, href);

    const readmeContentHtml = await getReadmeContentHtml(page);

    if (!readmeContentHtml.trim()) {
      return [];
    }

    const bodyContent = await page.evaluate((contentHtml) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = contentHtml;
      return wrapper.textContent || '';
    }, readmeContentHtml);

    const sentences =
      bodyContent
        ?.split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line, index) => {
          const sentenceId = getSentenceId({
            ...chapterParams,
            pageNumber: 1,
            sentenceNumber: index + 1,
          });

          const sentence: SingleLanguageSentence = {
            type: 'single',
            languageCode: 'V',
            id: sentenceId,
            text: line,
          };

          return sentence;
        }) || [];

    return [
      {
        id: getPageId({ ...chapterParams, pageNumber: 1 }),
        number: 1,
        sentences,
      },
    ];
  } finally {
    await context.close();
    await browser.close();
  }
};

export { getPageContentVie };
