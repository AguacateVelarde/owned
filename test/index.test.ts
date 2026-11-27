import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineConfig, defineRoute, z } from 'owned'
import { analyzeRoute } from '../src/contract/analyze.ts'

test('a route written with the public API passes the contract checker', () => {
  const route = defineRoute({
    auth: 'user',
    input: { params: z.object({ id: z.string() }) },
    load: ({ params }) => ({ id: params.id, userId: 'u1' }),
    owner: 'userId',
    output: z.object({ ok: z.literal(true) }),
    handler: () => ({ ok: true as const }),
  })
  assert.deepEqual(analyzeRoute('orders.$id.delete.ts', route).violations, [])
})

test('defineRoute and defineConfig return what they were given', () => {
  const route = { auth: 'public' as const, input: {}, output: z.object({}), handler: () => ({}) }
  assert.equal(defineRoute(route), route)
  const config = { authenticate: () => null }
  assert.equal(defineConfig(config), config)
})
