import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import valuesSchema from '../lib/schema.js';
import runReadmeGenerator from '../index.js';

const validate = (schema, value) => new Ajv({ allowUnionTypes: true }).compile(schema)(value);

test('keeps dotted keys, integer types, nullable declarations and structured arrays', () => {
  const defaults = { replicas: 2, annotations: { 'example.io/name': 'demo' }, rows: [{ name: 'a', count: 3 }], port: null };
  const before = structuredClone(defaults);
  const result = valuesSchema(defaults, [{ name: 'port', description: 'Optional port',
    modifiers: ['integer', 'nullable'] }]);
  expect(result.$schema).toContain('draft-07');
  expect(result.properties.replicas.type).toBe('integer');
  expect(result.properties.annotations.properties['example.io/name'].type).toBe('string');
  expect(result.properties.port.type).toEqual(['integer', 'null']);
  expect(result.properties.rows.items.properties.count.type).toBe('integer');
  expect(validate(result, defaults)).toBe(true);
  expect(validate(result, { ...defaults, replicas: 1.5 })).toBe(false);
  expect(defaults).toEqual(before);
});

test('requires explicit unknown domains and preserves authored bounds without mutation', () => {
  const defaults = { labels: {}, ports: [], unknown: null };
  expect(() => valuesSchema(defaults)).toThrow('empty-map');
  const overlay = { properties: { labels: { additionalProperties: { type: 'string' } },
    ports: { items: { type: 'integer', minimum: 1, maximum: 65535 } }, unknown: { type: ['string', 'null'] } } };
  const before = structuredClone(overlay);
  const result = valuesSchema(defaults, [], overlay);
  expect(validate(result, { labels: { role: 'worker' }, ports: [8080], unknown: null })).toBe(true);
  expect(validate(result, { ...defaults, ports: [0] })).toBe(false);
  expect(overlay).toEqual(before);
  expect(() => valuesSchema({ ports: [] })).toThrow('empty-array');
  expect(() => valuesSchema({ unknown: null })).toThrow('unknown values domain');
});

test('rejects contradictory declarations, invalid defaults and external references', () => {
  expect(() => valuesSchema({ port: 2 }, [{ name: 'port', modifiers: ['string', 'integer'] }])).toThrow('Conflicting');
  expect(() => valuesSchema({ port: 2 }, [], { properties: { port: { minimum: 3 } } })).toThrow('(minimum)');
  expect(() => valuesSchema({ port: 2 }, [], { properties: { port: { type: 'imaginary' } } })).toThrow();
  expect(() => valuesSchema({ port: 2 }, [], { properties: { port: { $ref: 'https://schema.invalid/value' } } })).toThrow();
});

test('preserves heterogeneous item domains and does not infer requiredness', () => {
  const result = valuesSchema({ mixed: [1, 'one', false], scale: 1.5 });
  expect(result.properties.mixed.items.anyOf.map((item) => item.type)).toEqual(['integer', 'string', 'boolean']);
  expect(result).not.toHaveProperty('required');
  expect(validate(result, { mixed: ['one', 2, true], scale: 1 })).toBe(true);
  expect(validate(result, { mixed: [{}], scale: 1 })).toBe(false);
});

test('rejects cyclic/nonfinite input and ambiguous dotted annotation ownership', () => {
  const cyclic = {}; cyclic.self = cyclic;
  expect(() => valuesSchema(cyclic)).toThrow('Cyclic');
  expect(() => valuesSchema({ rate: Number.POSITIVE_INFINITY })).toThrow('Nonfinite');
  expect(() => valuesSchema({ 'a.b': 1, a: { b: 2 } }, [{ name: 'a.b', modifiers: [] }])).toThrow('Ambiguous');
});

test('structural CLI generation validates before replacing its schema destination', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'structural-values-'));
  try {
    const values = path.join(folder, 'values.yaml');
    const output = path.join(folder, 'values.schema.json');
    fs.writeFileSync(values, 'replicas: 2\n');
    runReadmeGenerator({ values, schema: output, schemaDialect: 'draft7' });
    expect(JSON.parse(fs.readFileSync(output, 'utf8')).properties.replicas.type).toBe('integer');
    const before = fs.readFileSync(output);
    fs.writeFileSync(values, 'ports: []\n');
    expect(() => runReadmeGenerator({ values, schema: output, schemaDialect: 'draft7' })).toThrow('empty-array');
    expect(fs.readFileSync(output)).toEqual(before);
  } finally {
    fs.rmSync(folder, { recursive: true });
  }
});


test('preserves valid constraint-only conditional branches from authored schemas', () => {
  const overlay = { properties: { mode: { enum: ['local', 'remote'] } },
    if: { properties: { mode: { const: 'remote' } } },
    then: { properties: { endpoint: { minLength: 1 } } } };
  const result = valuesSchema({ mode: 'local', endpoint: '' }, [], overlay);
  expect(validate(result, { mode: 'local', endpoint: '' })).toBe(true);
  expect(validate(result, { mode: 'remote', endpoint: '' })).toBe(false);
  expect(() => valuesSchema({ date: new Date() })).toThrow('non-JSON');
});
