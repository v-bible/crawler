import { type Page } from 'playwright';

const evalLog = (page: Page) => {
  // eslint-disable-next-line no-console
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
};

export { evalLog };
