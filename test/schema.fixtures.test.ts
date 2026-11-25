import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { toJsonSchema, UNSUPPORTED_KEY } from '../src/contract/schema.ts'

const shape = { a: z.string() }
const closedA = {
  type: 'object',
  properties: { a: { type: 'string' } },
  required: ['a'],
  additionalProperties: false,
}

interface Fixture {
  name: string
  schema: z.ZodType
  output: unknown
  input?: unknown
}

const fixtures: Fixture[] = [
  {
    name: 'object (strip): closed on output, no additionalProperties on input',
    schema: z.object(shape),
    output: closedA,
    input: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  },
  { name: 'strictObject', schema: z.strictObject(shape), output: closedA },
  {
    name: 'looseObject',
    schema: z.looseObject(shape),
    output: { ...closedA, additionalProperties: {} },
  },
  {
    name: 'passthrough',
    schema: z.object(shape).passthrough(),
    output: { ...closedA, additionalProperties: {} },
  },
  {
    name: 'catchall',
    schema: z.object(shape).catchall(z.string()),
    output: { ...closedA, additionalProperties: { type: 'string' } },
  },
  {
    name: 'record',
    schema: z.record(z.string(), z.number()),
    output: {
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { type: 'number' },
    },
  },
  { name: 'any', schema: z.any(), output: {} },
  { name: 'unknown', schema: z.unknown(), output: {} },
  { name: 'nullable', schema: z.string().nullable(), output: { type: ['string', 'null'] } },
  {
    name: 'optional field',
    schema: z.object({ a: z.string().optional() }),
    output: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
    input: { type: 'object', properties: { a: { type: 'string' } } },
  },
  { name: 'union of primitives', schema: z.union([z.string(), z.number()]), output: { type: ['string', 'number'] } },
  {
    name: 'union of objects',
    schema: z.union([z.object(shape), z.looseObject({ b: z.string() })]),
    output: {
      anyOf: [
        closedA,
        {
          type: 'object',
          properties: { b: { type: 'string' } },
          required: ['b'],
          additionalProperties: {},
        },
      ],
    },
    input: {
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        {
          type: 'object',
          properties: { b: { type: 'string' } },
          required: ['b'],
          additionalProperties: {},
        },
      ],
    },
  },
  {
    name: 'discriminatedUnion',
    schema: z.discriminatedUnion('t', [
      z.object({ t: z.literal('a') }),
      z.object({ t: z.literal('b') }),
    ]),
    output: {
      oneOf: [
        {
          type: 'object',
          properties: { t: { type: 'string', const: 'a' } },
          required: ['t'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { t: { type: 'string', const: 'b' } },
          required: ['t'],
          additionalProperties: false,
        },
      ],
    },
    input: {
      oneOf: [
        { type: 'object', properties: { t: { type: 'string', const: 'a' } }, required: ['t'] },
        { type: 'object', properties: { t: { type: 'string', const: 'b' } }, required: ['t'] },
      ],
    },
  },
  { name: 'enum', schema: z.enum(['x', 'y']), output: { type: 'string', enum: ['x', 'y'] } },
  { name: 'default', schema: z.string().default('x'), output: { default: 'x', type: 'string' } },
  {
    name: 'readonly',
    schema: z.object(shape).readonly(),
    output: { readOnly: true, ...closedA },
    input: { readOnly: true, type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  },
  {
    name: 'pipe: output side on output, input side on input',
    schema: z.string().transform((s) => s.length).pipe(z.number()),
    output: { type: 'number' },
    input: { type: 'string' },
  },
  {
    name: 'transform without pipe: unsupported on output',
    schema: z.string().transform((s) => s.length),
    output: { [UNSUPPORTED_KEY]: 'transform' },
    input: { type: 'string' },
  },
  { name: 'date: closed date-time string', schema: z.date(), output: { type: 'string', format: 'date-time' } },
  { name: 'bigint: unsupported', schema: z.bigint(), output: { [UNSUPPORTED_KEY]: 'bigint' } },
  { name: 'literal', schema: z.literal(true), output: { type: 'boolean', const: true } },
  {
    name: 'array of objects',
    schema: z.array(z.object(shape)),
    output: { type: 'array', items: closedA },
    input: {
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    },
  },
  {
    name: 'tuple',
    schema: z.tuple([z.string(), z.number()]),
    output: {
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    },
  },
  {
    name: 'lazy',
    schema: z.lazy(() => z.object(shape)),
    output: closedA,
    input: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  },
]

for (const f of fixtures) {
  test(`toJsonSchema output: ${f.name}`, () => {
    assert.deepEqual(toJsonSchema(f.schema, 'output'), f.output)
  })
  test(`toJsonSchema input: ${f.name}`, () => {
    assert.deepEqual(toJsonSchema(f.schema, 'input'), f.input ?? f.output)
  })
}

test('toJsonSchema: recursive schema emits a $ref to the root', () => {
  const Node: z.ZodType = z.object({
    name: z.string(),
    get children() {
      return z.array(Node)
    },
  })
  assert.deepEqual(toJsonSchema(Node, 'output'), {
    type: 'object',
    properties: {
      name: { type: 'string' },
      children: { type: 'array', items: { $ref: '#' } },
    },
    required: ['name', 'children'],
    additionalProperties: false,
  })
})

test('toJsonSchema: reused schema with an id lands in $defs', () => {
  const Shared = z.object(shape).meta({ id: 'Shared' })
  assert.deepEqual(toJsonSchema(z.object({ x: Shared, y: Shared }), 'output'), {
    type: 'object',
    properties: { x: { $ref: '#/$defs/Shared' }, y: { $ref: '#/$defs/Shared' } },
    required: ['x', 'y'],
    additionalProperties: false,
    $defs: { Shared: closedA },
  })
})
