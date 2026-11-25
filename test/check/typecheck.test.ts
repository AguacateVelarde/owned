import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTscOutput, resolveProjectTsc, runTypecheck } from '../../src/check/typecheck.ts'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

test('each tsc diagnostic becomes a typecheck error with its position', () => {
  const output = [
    "db.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.",
    "routes/a.get.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  ].join('\n')
  const violations = parseTscOutput(output)
  assert.deepEqual(
    violations.map((v) => [v.id, v.severity, v.rule, v.file]),
    [
      ['typecheck', 'error', 17, 'db.ts'],
      ['typecheck', 'error', 17, 'routes/a.get.ts'],
    ],
  )
  assert.equal(violations[0]?.message, "1:14 TS2322 Type 'number' is not assignable to type 'string'.")
  assert.match(violations[0]?.fix ?? '', /db\.ts:1:14/)
})

test('indented continuation lines belong to the diagnostic above', () => {
  const output = [
    "routes/a.get.ts(3,5): error TS2322: Type '{ id: number; }' is not assignable to type 'Order'.",
    "  Types of property 'id' are incompatible.",
    "    Type 'number' is not assignable to type 'string'.",
  ].join('\n')
  const [only, ...rest] = parseTscOutput(output)
  assert.deepEqual(rest, [])
  assert.match(only?.message ?? '', /Order'\.\n {2}Types of property 'id' are incompatible\.\n {4}Type 'number'/)
})

test('diagnostics without a file are attributed to tsconfig.json', () => {
  const [v] = parseTscOutput("error TS5023: Unknown compiler option 'strictest'.")
  assert.equal(v?.file, 'tsconfig.json')
  assert.match(v?.message ?? '', /TS5023 Unknown compiler option/)
})

test('erasable-syntax errors get the as const fix', () => {
  const [v] = parseTscOutput("routes/s.get.ts(1,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.")
  assert.match(v?.fix ?? '', /as const/)
})

test('extension errors on relative imports get the .ts fix', () => {
  const [v] = parseTscOutput(
    "routes/h.get.ts(2,23): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../db.ts'?",
  )
  assert.match(v?.fix ?? '', /add the \.ts extension/)
})

test('empty output means no violations', () => {
  assert.deepEqual(parseTscOutput(''), [])
  assert.deepEqual(parseTscOutput('\n'), [])
})

test('a project without tsconfig.json skips the typecheck with a warning', async () => {
  const violations = await runTypecheck(fixture('no-tsconfig'))
  assert.deepEqual(violations.map((v) => [v.id, v.severity, v.file]), [['typecheck-skipped', 'warning', 'tsconfig.json']])
  assert.match(violations[0]?.fix ?? '', /"erasableSyntaxOnly": true/)
})

test('a project without typescript installed skips the typecheck with a warning', async () => {
  const violations = await runTypecheck(fixture('clean'), { resolveTsc: () => undefined })
  assert.deepEqual(violations.map((v) => [v.id, v.severity]), [['typecheck-skipped', 'warning']])
  assert.match(violations[0]?.fix ?? '', /npm install --save-dev typescript/)
})

test('a clean project typechecks without violations', async () => {
  assert.deepEqual(await runTypecheck(fixture('clean')), [])
})

test('a broken project reports type errors in route files', async () => {
  const files = new Set((await runTypecheck(fixture('broken'))).map((v) => v.file))
  assert.ok(files.has('routes/status.get.ts'), [...files].join(', '))
  assert.ok(files.has('routes/history.get.ts'), [...files].join(', '))
})

test('resolveProjectTsc finds the project typescript and returns undefined when there is none', () => {
  assert.match(resolveProjectTsc(fixture('clean')) ?? '', /typescript[\\/]bin[\\/]tsc$/)
  const empty = mkdtempSync(join(tmpdir(), 'owned-no-ts-'))
  try {
    writeFileSync(join(empty, 'package.json'), '{ "type": "module" }')
    assert.equal(resolveProjectTsc(empty), undefined)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('owned check never writes compiled files, even when tsconfig.json would emit', async () => {
  const emitted = join(fixture('emits'), 'routes', 'orders.get.js')
  rmSync(emitted, { force: true })
  assert.deepEqual(await runTypecheck(fixture('emits')), [])
  assert.equal(existsSync(emitted), false)
})
