#!/usr/bin/env node
try {
  require('../dist/src/cli').main();
} catch (error) {
  if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  require('ts-node/register');
  require('../src/cli').main();
}
