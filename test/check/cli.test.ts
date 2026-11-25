import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../../bin/owned.ts', import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

function owned(cwd: string, ...args: string[]) {
  const env = { ...process.env }
  delete env.OWNED_CHECK
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

interface JsonReport {
  ok: boolean
  errors: number
  warnings: number
  unsafeCount: number
  routes: Array<{ file: string; method: string; path: string; shape: string }>
  violations: Array<{ id: string; file: string; fix: string }>
}

function checkJson(name: string): { code: number | null; report: JsonReport } {
  const { code, stdout } = owned(fixture(name), 'check', '--json')
  return { code, report: JSON.parse(stdout) as JsonReport }
}

test('a clean project passes with exit 0', () => {
  const { code, stdout } = owned(fixture('clean'), 'check')
  assert.equal(code, 0)
  assert.match(stdout, /✓ 2 routes · 0 errors · 0 warnings · 0 unsafe/)
})

test('route modules are imported with OWNED_CHECK=1 so they can skip side effects', () => {
  const { report } = checkJson('clean')
  assert.deepEqual(report.violations, [])
  assert.deepEqual(
    report.routes.map((r) => [r.file, r.method, r.path, r.shape]),
    [
      ['routes/orders.get.ts', 'get', '/orders', 'list'],
      ['routes/products.get.ts', 'get', '/products', 'list'],
    ],
  )
})

test('a broken project fails with exit 1 and reports every problem', () => {
  const { code, report } = checkJson('broken')
  assert.equal(code, 1)
  assert.equal(report.ok, false)
  const byFile = report.violations
    .filter((v) => v.id !== 'typecheck')
    .map((v) => [v.file, v.id])
    .sort()
  assert.deepEqual(byFile, [
    ['routes/admin/users.get.ts', 'file-name'],
    ['routes/health.get.ts', 'module-load'],
    ['routes/history.get.ts', 'module-load'],
    ['routes/legacy.get.ts', 'module-load'],
    ['routes/notes.txt', 'file-name'],
    ['routes/orders.$id.delete.ts', 'load-required'],
    ['routes/orders.post.ts', 'owner-from-client'],
    ['routes/stats.get.ts', 'contract-missing'],
    ['routes/status.get.ts', 'module-load'],
    ['routes/users.$id.get.ts', 'sensitive-field'],
  ])
})

test('a broken project also reports type errors from tsc', () => {
  const { report } = checkJson('broken')
  const typeErrors = report.violations.filter((v) => v.id === 'typecheck').map((v) => v.file)
  assert.ok(typeErrors.includes('routes/status.get.ts'))
})

test('a project without tsconfig.json passes with a typecheck-skipped warning', () => {
  const { code, report } = checkJson('no-tsconfig')
  assert.equal(code, 0)
  assert.equal(report.ok, true)
  assert.deepEqual(report.violations.map((v) => v.id), ['typecheck-skipped'])
})

test('load errors come back as fixes the agent can apply', () => {
  const { report } = checkJson('broken')
  const fixFor = (file: string) => report.violations.find((v) => v.file === file)?.fix ?? ''
  assert.match(fixFor('routes/history.get.ts'), /'\.\.\/db\.ts'/)
  assert.match(fixFor('routes/status.get.ts'), /as const/)
  assert.match(fixFor('routes/health.get.ts'), /getDb\(\)/)
  assert.match(report.violations.find((v) => v.file === 'routes/legacy.get.ts')?.fix ?? '', /getDb\(\)/)
})

test('human output for a broken project names files under routes/', () => {
  const { code, stdout } = owned(fixture('broken'), 'check')
  assert.equal(code, 1)
  assert.match(stdout, /✗ routes\/orders\.\$id\.delete\.ts {2}\[rule 3 load-required\]/)
  assert.match(stdout, /8 routes · \d+ errors · 0 warnings · 0 unsafe/)
})

test('a project without routes/ is a usage error with exit 2', () => {
  const { code, stderr } = owned(fixture('no-routes'), 'check')
  assert.equal(code, 2)
  assert.match(stderr, /no routes\/ directory/)
})

test('an unknown command prints usage with exit 2', () => {
  const { code, stderr } = owned(fixture('clean'), 'deploy')
  assert.equal(code, 2)
  assert.match(stderr, /usage: owned check \[--json\]/)
})

test('no command prints usage with exit 2', () => {
  const { code, stderr } = owned(fixture('clean'))
  assert.equal(code, 2)
  assert.equal(stderr, 'usage: owned check [--json]\n')
})

test('an unknown flag prints usage with exit 2', () => {
  const { code, stderr } = owned(fixture('clean'), 'check', '--yaml')
  assert.equal(code, 2)
  assert.match(stderr, /unknown option --yaml/)
})
