import type { CommandContext } from '@stricli/core';

export interface LocalContext extends CommandContext {
  readonly process: NodeJS.Process;
  // Add any custom context properties here if needed
}

export function buildContext(process: NodeJS.Process): LocalContext {
  return {
    process,
  };
}
