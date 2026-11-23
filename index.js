/*
* Copyright Broadcom, Inc. All Rights Reserved.
* SPDX-License-Identifier: Apache-2.0
*/

import fs from 'node:fs';
import * as YAML from 'yaml';
import valuesSchema from './lib/schema.js';
import pjson from './package.json' with { type: "json" };

import { createValuesObject, parseMetadataComments } from './lib/parser.js';
import checkKeys from './lib/checker.js';
import { combineMetadataAndValues, buildParamsToRenderList } from './lib/builder.js';
import { insertReadmeTable, renderOpenAPISchema } from './lib/render.js';

// Common alias for __dirname not available in ESM
const __dirname = import.meta.dirname;

function getParsedMetadata(valuesFilePath, config) {
  const valuesObject = createValuesObject(valuesFilePath);
  const valuesMetadata = parseMetadataComments(valuesFilePath, config);

  // Check the parsed keys are consistent with the real ones
  checkKeys(valuesObject, valuesMetadata.parameters);

  // Combine after the check
  // valuesMetadata is modified and filled with more info
  combineMetadataAndValues(valuesObject, valuesMetadata.parameters);

  return valuesMetadata;
}

export default function runReadmeGenerator(options) {
  const valuesFilePath = options.values;
  const readmeFilePath = options.readme;
  const schemaFilePath = options.schema;
  const versionFlag = options.version;

  if (versionFlag) {
    console.log('Version:', pjson.version);
  } else {
    if (!readmeFilePath && !schemaFilePath) {
      throw new Error('Nothing to do. Please provide the --readme or --schema options.');
    }
    if (!valuesFilePath) {
      throw new Error('Nothing to do. You must provide the --values option');
    }
    const configPath = options.config ? options.config : `${__dirname}/config.json`;
    const config = JSON.parse(fs.readFileSync(configPath));
    if (options.schemaOverlay && options.schemaDialect !== 'draft7') {
      throw new Error('Schema refinements require --schema-dialect draft7');
    }
    if (options.schemaDialect && !schemaFilePath) {
      throw new Error('A structural schema dialect requires a schema destination');
    }
    if (options.schemaDialect && options.schemaDialect !== 'draft7') {
      throw new Error('Supported structural schema dialect: draft7');
    }
    // Compute and validate the structural output before modifying either destination.
    const structural = schemaFilePath && options.schemaDialect === 'draft7'
      ? valuesSchema(YAML.parse(fs.readFileSync(valuesFilePath, 'utf8')),
        parseMetadataComments(valuesFilePath, config).parameters,
        options.schemaOverlay ? JSON.parse(fs.readFileSync(options.schemaOverlay, 'utf8')) : {})
      : null;
    const parsedMetadata = readmeFilePath || !structural ? getParsedMetadata(options.values, config) : null;

    if (readmeFilePath) {
      /* eslint no-param-reassign: ["error", { "props": false }] */
      parsedMetadata.sections.forEach((section) => {
        section.parameters = buildParamsToRenderList(section.parameters, config);
      });
      insertReadmeTable(readmeFilePath, parsedMetadata.sections, config);
    }

    if (structural) {
      fs.writeFileSync(schemaFilePath, JSON.stringify(structural, null, 2) + '\n');
    } else if (schemaFilePath) {
      parsedMetadata.parameters = buildParamsToRenderList(parsedMetadata.parameters, config);
      renderOpenAPISchema(schemaFilePath, parsedMetadata.parameters, config);
    }
  }
}

