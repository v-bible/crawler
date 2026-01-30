import { type Crawler } from '@/lib/crawler/crawler';

/**
 * Site crawler registry
 * Maps site names to their crawler instances
 */
export type SiteCrawlerFactory = () => Promise<Crawler>;

export const AVAILABLE_SITES = [
  'augustino.net',
  'conggiao.org',
  'dongten.net',
  'hdgmvietnam.com',
  'ktcgkpv.org',
  'rongmotamhon.net',
  'thanhlinh.net',
] as const;

export type AvailableSite = (typeof AVAILABLE_SITES)[number];

/**
 * Registry of site crawlers
 * Dynamically imports site main.ts files to preserve flexibility
 */
export const siteRegistry: Record<AvailableSite, () => Promise<Crawler>> = {
  'augustino.net': async () => {
    const { crawler } = await import('@/sites/augustino.net/main');
    return crawler;
  },
  'conggiao.org': async () => {
    const { crawler } = await import('@/sites/conggiao.org/main');
    return crawler;
  },
  'dongten.net': async () => {
    const { crawler } = await import('@/sites/dongten.net/main');
    return crawler;
  },
  'hdgmvietnam.com': async () => {
    const { crawler } = await import('@/sites/hdgmvietnam.com/main');
    return crawler;
  },
  'ktcgkpv.org': async () => {
    const { crawler } = await import('@/sites/ktcgkpv.org/main');
    return crawler;
  },
  'rongmotamhon.net': async () => {
    const { crawler } = await import('@/sites/rongmotamhon.net/main');
    return crawler;
  },
  'thanhlinh.net': async () => {
    const { crawler } = await import('@/sites/thanhlinh.net/main');
    return crawler;
  },
};

/**
 * Check if a site name is valid
 */
export function isValidSite(site: string): site is AvailableSite {
  return AVAILABLE_SITES.includes(site as AvailableSite);
}
