/*
 * Copyright Astrivant contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import Ajv from 'ajv';

const TYPES = new Set(['string', 'boolean', 'integer', 'number', 'object', 'array']);

/**
 * Merge a JSON Schema refinement without mutating either caller-owned input.
 * Arrays and scalar/boolean schemas replace their corresponding input value.
 * @param {object|boolean} base Inferred schema or child keyword.
 * @param {object|boolean} patch Explicit author-supplied refinement.
 * @returns {object|boolean} Independently owned merged value.
 */
function refine(base, patch) {
  if (!base || !patch || Array.isArray(base) || Array.isArray(patch)
      || typeof base !== 'object' || typeof patch !== 'object') {
    return structuredClone(patch);
  }
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  return Object.fromEntries([...keys].map((key) => [key,
    Object.hasOwn(patch, key) ? refine(base[key], patch[key]) : structuredClone(base[key]),
  ]));
}

/**
 * Infer structural types from JSON-compatible YAML while retaining explicit unknown domains.
 * Metadata describes fields; it does not invent requiredness or numeric bounds.
 * @param {object} values Raw root YAML mapping, never flattened into dotted keys.
 * @param {Array<object>} parameters Parsed Bitnami parameter annotations.
 * @returns {object} Draft-7-compatible schema retaining literal map keys and array item types.
 */
function infer(values, parameters) {
  const metadata = new Map(parameters.filter((p) => !p.extra).map((p) => [p.name, p]));
  const bindings = new Map();
  let visited = 0;

  function node(value, tokens, ancestors, defaults = true) {
    visited += 1;
    const path = tokens.join('.');
    if (visited > 100000 || tokens.length > 64) throw new Error('Values exceed structural schema traversal bounds');
    if (value && typeof value === 'object' && ancestors.has(value)) {
      throw new Error(`Cyclic YAML is outside the JSON values domain at ${path || '/'}`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Nonfinite YAML number at ${path || '/'}`);
    }
    const before = bindings.get(path) ?? 0;
    bindings.set(path, before + 1);
    const annotation = metadata.get(path);
    if (before && annotation) throw new Error(`Ambiguous dotted annotation path: ${path}`);
    const next = new Set(ancestors);
    if (value && typeof value === 'object') next.add(value);
    let result;
    if (value === null) {
      // A null default alone supplies no evidence about its permitted non-null type.
      result = {};
    } else if (Array.isArray(value)) {
      const shapes = value.map((item, index) => node(item, [...tokens.slice(0, -1),
        `${tokens.at(-1)}[${index}]`], next, false));
      const unique = [...new Map(shapes.map((shape) => [JSON.stringify(shape), shape])).values()];
      result = { type: 'array', items: unique.length === 1 ? unique[0] : unique.length ? { anyOf: unique } : {} };
    } else if (typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new Error(`Unsupported non-JSON object at ${path || '/'}`);
      }
      const entries = Object.entries(value);
      result = { type: 'object', properties: Object.fromEntries(entries.map(([key, child]) =>
        [key, node(child, [...tokens, key], next, defaults)])), additionalProperties: entries.length === 0 };
    } else if (typeof value === 'number') {
      result = { type: Number.isInteger(value) ? 'integer' : 'number' };
    } else if (typeof value === 'string' || typeof value === 'boolean') {
      result = { type: typeof value };
    } else {
      throw new Error(`Unsupported YAML value at ${path || '/'}`);
    }
    if (annotation) {
      if (annotation.description) result.description = annotation.description;
      const declared = annotation.modifiers.filter((modifier) => TYPES.has(modifier));
      if (new Set(declared).size > 1) throw new Error(`Conflicting type annotations at ${path}`);
      if (declared.length) result.type = declared[0];
      if (annotation.modifiers.includes('nullable') && result.type) {
        result.type = [result.type, 'null'];
      }
    }
    if (defaults) result.default = structuredClone(value);
    return result;
  }

  if (!values || Array.isArray(values) || typeof values !== 'object') {
    throw new Error('Helm values must have an object root');
  }
  const result = node(values, [], new Set());
  for (const [name, annotation] of metadata) {
    if (!bindings.has(name) && !annotation.skip) throw new Error(`Annotation has no values binding: ${name}`);
  }
  return result;
}

/**
 * Reject unconstrained inferred domains unless an author explicitly supplies that contract.
 * @param {object|boolean} node Complete schema node.
 * @param {object|boolean} explicit Matching refinement supplied by the chart author.
 * @param {string} path JSON pointer identifying a schema location, without value contents.
 * @returns {void} Throws a bounded diagnostic for unresolved fields or external references.
 */
function checkDomains(node, explicit = {}, path = '') {
  if (typeof node === 'boolean') return;
  if (node.$ref) {
    if (!node.$ref.startsWith('#')) throw new Error(`Only local schema references are supported at ${path || '/'}`);
    return;
  }
  const supplied = explicit && typeof explicit === 'object' ? explicit : {};
  if (!node.type && !node.anyOf && !node.oneOf && !node.allOf && !node.enum && !Object.hasOwn(node, 'const')) {
    throw new Error(`Declare the unknown values domain at ${path || '/'} in the schema overlay`);
  }
  if (node.type === 'array' && node.items && Object.keys(node.items).length === 0) {
    throw new Error(`Declare empty-array items at ${path || '/'} in the schema overlay`);
  }
  if (node.type === 'object' && Object.keys(node.properties ?? {}).length === 0
      && node.additionalProperties === true && !Object.hasOwn(supplied, 'additionalProperties')) {
    throw new Error(`Declare the empty-map domain at ${path || '/'} in the schema overlay`);
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const escaped = key.replaceAll('~', '~0').replaceAll('/', '~1');
    checkDomains(child, supplied.properties?.[key], `${path}/properties/${escaped}`);
  }
  if (node.items && typeof node.items === 'object') checkDomains(node.items, supplied.items, `${path}/items`);
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    // Author-supplied combinators may be valid constraint-only refinements of surrounding types.
    if (Object.hasOwn(supplied, keyword) || Object.hasOwn(supplied, 'type')) continue;
    (node[keyword] ?? []).forEach((child, index) =>
      checkDomains(child, supplied[keyword]?.[index], `${path}/${keyword}/${index}`));
  }
}

/**
 * Build and validate a structural Helm values contract for Hypothesis Helm and Helm itself.
 * @param {object} values JSON-compatible YAML defaults, left unchanged.
 * @param {Array<object>} parameters Definition-only Bitnami parameter annotations.
 * @param {object} overlay Author-supplied JSON Schema refinements, left unchanged.
 * @returns {object} Validated Draft-7 schema whose actual source defaults are accepted.
 */
export default function valuesSchema(values, parameters = [], overlay = {}) {
  const result = refine({ $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Chart Values', ...infer(values, parameters) }, overlay);
  const validator = new Ajv({
    allErrors: true,
    strictSchema: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    allowUnionTypes: true,
    validateFormats: false
  });
  checkDomains(result, overlay);
  const validate = validator.compile(result);
  if (!validate(values)) {
    const error = validate.errors[0];
    throw new Error(`Values defaults violate the schema at ${error.instancePath || '/'} (${error.keyword})`);
  }
  return result;
}
