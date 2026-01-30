import { buildCommand } from '@stricli/core';
import { AVAILABLE_SITES } from '@/sites/registry';

export const crawlCommand = buildCommand({
  loader: async () => {
    const { crawl } = await import('./impl');
    return crawl;
  },
  parameters: {
    flags: {
      site: {
        kind: 'parsed',
        brief: `Site to crawl. Available: ${AVAILABLE_SITES.join(', ')}, or 'all' for all sites`,
        parse: String,
        default: 'all',
      },
      timeout: {
        kind: 'parsed',
        brief: 'Timeout in milliseconds for each crawl operation',
        parse: Number,
        optional: true,
      },
      verbose: {
        kind: 'boolean',
        brief: 'Enable verbose logging',
        optional: true,
      },
    },
  },
  docs: {
    brief: 'Crawl websites to extract content',
  },
});
