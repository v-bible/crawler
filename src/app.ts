import {
  buildInstallCommand,
  buildUninstallCommand,
} from '@stricli/auto-complete';
import { buildApplication, buildRouteMap } from '@stricli/core';
import { description, version } from '../package.json';
import { crawlCommand } from '@/commands/crawl';

const routes = buildRouteMap({
  routes: {
    crawl: crawlCommand,
    install: buildInstallCommand('crawler', {
      bash: '__crawler_bash_complete',
    }),
    uninstall: buildUninstallCommand('crawler', { bash: true }),
  },
  docs: {
    brief: description,
    hideRoute: {
      install: true,
      uninstall: true,
    },
  },
});

export const app = buildApplication(routes, {
  name: 'crawler',
  versionInfo: {
    currentVersion: version,
  },
});
