# Structural JSON Schema for Helm values

The fork adds an opt-in Draft-7 mode for Helm and [Hypothesis Helm](https://github.com/astrivant/hypothesis-helm).
Legacy `--schema` OpenAPI output remains unchanged unless the dialect is selected.

```console
readme-generator --values chart/values.yaml --schema chart/values.schema.json --schema-dialect draft7
```

The generator walks the original YAML mapping rather than flattened dotted paths.
It preserves literal keys such as `example.io/name`, uses integer types for whole numbers,
and describes structured and heterogeneous array items. Existing `@param` comments supply descriptions;
`[integer]`, `[number]`, `[boolean]`, `[string]`, `[object]`, `[array]` and `[nullable]`
supply explicit type evidence. A null default does not establish its other permitted type.
The generator does not infer requiredness, numeric limits or enumerations from examples.

Empty arrays, untyped nulls and empty maps require an explicit contract. Supply a JSON Schema
refinement using `--schema-overlay chart/values.constraints.json`. For example:

```json
{
  "properties": {
    "ports": {"items": {"type": "integer", "minimum": 1, "maximum": 65535}},
    "labels": {"additionalProperties": {"type": "string"}},
    "optionalPort": {"type": ["integer", "null"]}
  }
}
```

Refinements merge object keywords recursively; arrays, scalars and boolean schemas replace
corresponding values. Inputs are not mutated. Add constraints using standard JSON Schema,
including local references. Remote references are rejected and never fetched. Ajv validates
both the schema and the actual YAML defaults before output replaces an existing destination.
Validation errors identify the schema/value path and keyword, without printing default values.
Display-only default modifiers do not replace actual YAML defaults in structural output.

The functional API is `valuesSchema(values, annotations, overlay)` from `lib/schema.js`.
Cycles, nonfinite numbers, unsupported objects, ambiguous annotation bindings and bounded
traversal exhaustion fail explicitly. An inferred nonempty object is closed to unknown keys;
use an explicit refinement for extensible dictionaries or dependency-owned values.
Schema validity does not establish template semantics or correctness of rendered Kubernetes
resources. Hypothesis Helm supplies those separate tests.

Run `npm ci`, `npm test -- --runInBand` and `npm run lint` with the declared Node 24 runtime.
The CLI emits INFO operational logs on stderr; `--debug` enables bounded diagnostics.
