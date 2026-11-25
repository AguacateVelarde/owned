import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  findSchemaIssues,
  isZodSchema,
  listFieldPaths,
  rootProperties,
  rootType,
  toJsonSchema,
} from '../src/contract/schema.ts'

const issues = (schema: z.ZodType, io: 'input' | 'output' = 'output') =>
  findSchemaIssues(toJsonSchema(schema, io))

test('closed schemas have no issues', () => {
  const closed: z.ZodType[] = [
    z.object({ a: z.string() }),
    z.strictObject({ a: z.string() }),
    z.object({}),
    z.array(z.object({ id: z.string() })),
    z.object({ a: z.string().nullable() }),
    z.object({ a: z.string().optional() }),
    z.object({ a: z.union([z.string(), z.number()]) }),
    z.discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })]),
    z.object({ status: z.enum(['open', 'closed']) }),
    z.object({ createdAt: z.date() }),
    z.object({ n: z.string().default('x') }),
    z.object({ a: z.string() }).readonly(),
    z.object({ len: z.string().transform((s) => s.length).pipe(z.number()) }),
    z.tuple([z.string(), z.number()]),
    z.literal(true),
  ]
  for (const schema of closed) {
    assert.deepEqual(issues(schema), [], JSON.stringify(toJsonSchema(schema, 'output')))
  }
})

test('nullable, union and discriminatedUnion are NOT false positives', () => {
  assert.deepEqual(issues(z.object({ a: z.object({ b: z.string() }).nullable() })), [])
  assert.deepEqual(issues(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])), [])
})

test('open schemas are reported with their path', () => {
  assert.deepEqual(issues(z.looseObject({ a: z.string() })), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.object({ a: z.string() }).passthrough()), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.object({ a: z.string() }).catchall(z.string())), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.record(z.string(), z.string())), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.any()), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.unknown()), [{ kind: 'open', path: '' }])
})

test('open schemas nested in arrays, unions and optionals are found', () => {
  assert.deepEqual(issues(z.object({ items: z.array(z.looseObject({ a: z.string() })) })), [
    { kind: 'open', path: 'items[]' },
  ])
  assert.deepEqual(issues(z.object({ meta: z.any().optional() })), [{ kind: 'open', path: 'meta' }])
  assert.deepEqual(
    issues(z.object({ v: z.union([z.string(), z.record(z.string(), z.number())]) })),
    [{ kind: 'open', path: 'v' }],
  )
  assert.deepEqual(issues(z.tuple([z.string(), z.any()])), [{ kind: 'open', path: '[1]' }])
})

test('open schemas inside $defs are found', () => {
  const Shared = z.looseObject({ a: z.string() }).meta({ id: 'Shared' })
  assert.deepEqual(issues(z.object({ x: Shared, y: Shared })), [{ kind: 'open', path: '$defs.Shared' }])
})

test('recursive schemas terminate', () => {
  const Node: z.ZodType = z.object({
    name: z.string(),
    get children() {
      return z.array(Node)
    },
  })
  assert.deepEqual(issues(Node), [])
})

test('wrappers around open types stay open, wrappers around unsupported types stay unsupported', () => {
  assert.deepEqual(issues(z.object({ a: z.any().default(1) })), [{ kind: 'open', path: 'a' }])
  assert.deepEqual(issues(z.object({ a: z.unknown().nullable() })), [{ kind: 'open', path: 'a' }])
  assert.deepEqual(issues(z.object({ n: z.bigint().optional() })), [
    { kind: 'unsupported', path: 'n', zodType: 'bigint' },
  ])
  assert.deepEqual(issues(z.object({ d: z.date().optional() })), [])
})

test('unsupported types are reported separately from open ones', () => {
  assert.deepEqual(issues(z.object({ n: z.bigint() })), [
    { kind: 'unsupported', path: 'n', zodType: 'bigint' },
  ])
  assert.deepEqual(issues(z.object({ len: z.string().transform((s) => s.length) })), [
    { kind: 'unsupported', path: 'len', zodType: 'transform' },
  ])
})

test('input side: plain z.object is fine (Zod strips extra keys), loose is open', () => {
  assert.deepEqual(issues(z.object({ title: z.string() }), 'input'), [])
  assert.deepEqual(issues(z.object({ len: z.string().transform((s) => s.length) }), 'input'), [])
  assert.deepEqual(issues(z.looseObject({ title: z.string() }), 'input'), [{ kind: 'open', path: '' }])
  assert.deepEqual(issues(z.object({ tags: z.record(z.string(), z.string()) }), 'input'), [
    { kind: 'open', path: 'tags' },
  ])
})

test('boolean schemas: true accepts anything, false rejects everything', () => {
  assert.deepEqual(findSchemaIssues(true), [{ kind: 'open', path: '' }])
  assert.deepEqual(findSchemaIssues(false), [])
  assert.deepEqual(findSchemaIssues({ type: 'array', items: true }), [{ kind: 'open', path: '[]' }])
  assert.deepEqual(findSchemaIssues({ type: 'array', items: false }), [])
})

test('listFieldPaths returns nested property paths', () => {
  const schema = z.object({
    id: z.string(),
    user: z.object({ passwordHash: z.string() }),
    items: z.array(z.object({ token: z.string() })),
  })
  assert.deepEqual(listFieldPaths(toJsonSchema(schema, 'output')).sort(), [
    'id',
    'items',
    'items[].token',
    'user',
    'user.passwordHash',
  ])
})

test('rootType and rootProperties', () => {
  assert.equal(rootType(toJsonSchema(z.array(z.string()), 'output')), 'array')
  assert.equal(rootType(toJsonSchema(z.object({}), 'output')), 'object')
  assert.equal(rootType(toJsonSchema(z.string().nullable(), 'output')), undefined)
  assert.deepEqual(rootProperties(toJsonSchema(z.object({ a: z.string(), b: z.number() }), 'output')), ['a', 'b'])
  assert.deepEqual(rootProperties(toJsonSchema(z.array(z.string()), 'output')), [])
})

test('isZodSchema', () => {
  assert.equal(isZodSchema(z.string()), true)
  assert.equal(isZodSchema({ type: 'string' }), false)
  assert.equal(isZodSchema(undefined), false)
})
