import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatHuman, formatJson, summarize } from '../../src/check/format.ts'
import type { Violation } from '../../src/contract/rules.ts'

const error: Violation = {
  rule: 3,
  id: 'load-required',
  severity: 'error',
  file: 'orders.$id.delete.ts',
  message: '/orders/:id acts on one resource; load it',
  fix: 'load: ({ params }) => getDb().orders.find(params.id),\nowner: \'userId\',',
}
const warning: Violation = {
  rule: 14,
  id: 'unsafe-used',
  severity: 'warning',
  file: 'stats.get.ts',
  message: 'unsafe.noOwner: "aggregate metrics, no per-user data"',
  fix: 'remove it unless the human asked for this exception',
}
const routes = [
  { file: 'orders.$id.delete.ts', method: 'delete', path: '/orders/:id', shape: 'resource' },
  { file: 'stats.get.ts', method: 'get', path: '/stats', shape: 'list' },
] as const

test('summarize counts errors, warnings and unsafe uses', () => {
  assert.deepEqual(summarize([error, warning]), { errors: 1, warnings: 1, unsafeCount: 1 })
  assert.deepEqual(summarize([]), { errors: 0, warnings: 0, unsafeCount: 0 })
})

test('human output shows file, rule, message and an indented fix', () => {
  const out = formatHuman({ routes: [...routes], violations: [error, warning] })
  assert.match(out, /✗ routes\/orders\.\$id\.delete\.ts {2}\[rule 3 load-required\]/)
  assert.match(out, /\n {2}\/orders\/:id acts on one resource; load it\n/)
  assert.match(out, /\n {2}fix:\n {4}load: \(\{ params \}\) => getDb\(\)\.orders\.find\(params\.id\),\n {4}owner: 'userId',/)
  assert.match(out, /⚠ routes\/stats\.get\.ts {2}\[rule 14 unsafe-used\]/)
})

test('human output lists errors before warnings', () => {
  const out = formatHuman({ routes: [...routes], violations: [warning, error] })
  assert.ok(out.indexOf('✗') < out.indexOf('⚠'))
})

test('human output ends with a summary line', () => {
  const out = formatHuman({ routes: [...routes], violations: [error, warning] })
  assert.match(out, /2 routes · 1 error · 1 warning · 1 unsafe\n?$/)
})

test('human output for a clean project', () => {
  const out = formatHuman({ routes: [...routes], violations: [] })
  assert.match(out, /✓ 2 routes · 0 errors · 0 warnings · 0 unsafe/)
})

test('json output carries counts, routes and violations', () => {
  const json = formatJson({ routes: [...routes], violations: [error, warning] })
  assert.deepEqual(json, {
    ok: false,
    errors: 1,
    warnings: 1,
    unsafeCount: 1,
    routes: [...routes],
    violations: [error, warning],
  })
})

test('json output is ok when there are only warnings', () => {
  assert.equal(formatJson({ routes: [], violations: [warning] }).ok, true)
})

test('human output uses singular nouns for one', () => {
  const out = formatHuman({ routes: [routes[0]], violations: [error] })
  assert.match(out, /1 route · 1 error · 0 warnings · 0 unsafe/)
})

test('blank lines inside a fix stay blank instead of becoming trailing spaces', () => {
  const withBlank: Violation = { ...error, fix: "owner: 'userId',\n\nor:\nunsafe: { noOwner: '...' }," }
  const out = formatHuman({ routes: [...routes], violations: [withBlank] })
  assert.match(out, / {4}owner: 'userId',\n\n {4}or:\n/)
})
