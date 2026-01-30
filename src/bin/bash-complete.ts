#!/usr/bin/env node
import { proposeCompletions } from '@stricli/core';
import { app } from '@/app';
import { buildContext } from '@/context';

(async () => {
  const inputs = process.argv.slice(3);
  if (process.env.COMP_LINE?.endsWith(' ')) {
    inputs.push('');
  }
  await proposeCompletions(app, inputs, buildContext(process));
  try {
    /* eslint-disable no-restricted-syntax */
    for (const { completion } of await proposeCompletions(
      app,
      inputs,
      buildContext(process),
    )) {
      process.stdout.write(`${completion}\n`);
    }
    /* eslint-enable no-restricted-syntax */
  } catch {
    // ignore
  }
})();
