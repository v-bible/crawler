import type { LocalContext } from '@/context';
import { logger } from '@/logger/logger';
import {
  AVAILABLE_SITES,
  type AvailableSite,
  isValidSite,
  siteRegistry,
} from '@/sites/registry';

export async function crawl(
  this: LocalContext,
  flags: {
    site: string;
    timeout?: number;
    verbose?: boolean;
  },
): Promise<void> {
  const { site, verbose } = flags;

  if (verbose) {
    logger.info(`Starting crawl for site: ${site}`);
  }

  // Determine which sites to crawl
  let sitesToCrawl: AvailableSite[] = [];
  if (site === 'all') {
    sitesToCrawl = [...AVAILABLE_SITES];
  } else if (isValidSite(site)) {
    sitesToCrawl = [site];
  }

  if (sitesToCrawl.length === 0) {
    logger.error(
      `Invalid site: ${site}. Available sites: ${AVAILABLE_SITES.join(', ')}`,
    );
    process.exit(1);
  }

  logger.info(`Crawling ${sitesToCrawl.length} site(s)...`);

  // Crawl each site sequentially
  /* eslint-disable no-restricted-syntax, no-await-in-loop */
  for (const siteName of sitesToCrawl) {
    try {
      logger.info(`\n→ Starting crawl for ${siteName}...`);

      const crawlerFactory = siteRegistry[siteName];
      const crawler = await crawlerFactory();

      // Run the crawler
      await crawler.run();

      logger.info(`✓ Completed crawl for ${siteName}`);
    } catch (error) {
      logger.error(`✗ Failed to crawl ${siteName}:`, error);

      if (verbose && error instanceof Error) {
        logger.error(error.stack);
      }
    }
  }
  /* eslint-enable no-restricted-syntax, no-await-in-loop */

  logger.info('\n✓ All crawls completed');
}
