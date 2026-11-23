#!/usr/bin/env node

/*
* Copyright Broadcom, Inc. All Rights Reserved.
* SPDX-License-Identifier: Apache-2.0
*/

import { program } from 'commander';
import runReadmeGenerator from '../index.js';

program
  .option('-v, --values <path>', 'Path to the values.yaml file')
  .option('-r, --readme <path>', 'Path to the README.md file')
  .option('-c, --config <path>', 'Path to the config file')
  .option('-s, --schema <path>', 'Path for the OpenAPI Schema output file')
  .option('--schema-dialect <dialect>', 'Use draft7 structural JSON Schema; legacy OpenAPI is unchanged by default')
  .option('--schema-overlay <path>', 'Author-supplied JSON Schema refinements for structural output')
  .option('--debug', 'Enable bounded DEBUG diagnostics')
  .option('--version', 'Show Readme Generator version');

program.parse(process.argv);

const options = program.opts();

console.error(`INFO Helm metadata generation started: schema=${Boolean(options.schema)}`
  + ` readme=${Boolean(options.readme)}`);
if (options.debug) console.error(`DEBUG Structural schema enabled: ${options.schemaDialect === 'draft7'}`);
runReadmeGenerator(options);
console.error('INFO Helm metadata generation completed');
