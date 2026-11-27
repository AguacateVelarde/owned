import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from 'hono'
import type { OwnedConfig } from 'owned'
import { ROUTE_TEMPLATES } from '../../src/init/templates.ts'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const bin = join(repo, 'bin', 'owned.ts')
const tmpRoot = join(repo, 'test', '.tmp')
mkdirSync(tmpRoot, { recursive: true })
const created: string[] = []
after(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function freshProject(): string {
  const dir = mkdtempSync(join(tmpRoot, 'init-'))
  created.push(dir)
  return dir
}

function owned(cwd: string, ...args: string[]) {
  const env = { ...process.env }
  delete env.OWNED_CHECK
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

function linkOwned(project: string) {
  mkdirSync(join(project, 'node_modules'), { recursive: true })
  symlinkSync(repo, join(project, 'node_modules', 'owned'), 'dir')
}

function fakeContext(headers: Record<string, string>): Context {
  return { req: { header: (name: string) => headers[name] } } as unknown as Context
}

test('owned init creates the project and tells you what to run next', () => {
  const project = freshProject()
  const { code, stdout } = owned(project, 'init')
  assert.equal(code, 0)
  assert.match(stdout, /created routes\/health\.get\.ts/)
  assert.match(stdout, /created AGENTS\.md/)
  assert.match(stdout, /npm install/)
  assert.match(stdout, /npx owned check/)
})

test('a freshly initialized project passes owned check with 0 errors and 0 warnings', () => {
  const project = freshProject()
  owned(project, 'init')
  linkOwned(project)
  const { code, stdout } = owned(project, 'check', '--json')
  const report = JSON.parse(stdout) as { errors: number; warnings: number; violations: unknown[] }
  assert.deepEqual(report.violations, [])
  assert.equal(code, 0)
})

test('every route template from AGENTS.md passes owned check, tsc included', () => {
  const project = freshProject()
  owned(project, 'init')
  linkOwned(project)
  for (const template of ROUTE_TEMPLATES) writeFileSync(join(project, 'routes', template.file), template.content)
  const { code, stdout } = owned(project, 'check', '--json')
  const report = JSON.parse(stdout) as { routes: Array<{ shape: string }>; violations: unknown[] }
  assert.deepEqual(report.violations, [])
  assert.deepEqual(report.routes.map((r) => r.shape).sort(), ['action', 'list', 'list', 'resource'])
  assert.equal(code, 0)
})

test('running owned init twice changes nothing', () => {
  const project = freshProject()
  owned(project, 'init')
  writeFileSync(join(project, 'AGENTS.md'), 'my own notes\n')
  const { code, stdout } = owned(project, 'init')
  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /^created/m)
  assert.match(stdout, /skipped AGENTS\.md \(already exists\)/)
  assert.equal(readFileSync(join(project, 'AGENTS.md'), 'utf8'), 'my own notes\n')
})

test('the generated authenticate reads x-user-id only in tests', async () => {
  const project = freshProject()
  owned(project, 'init')
  linkOwned(project)
  const config = (await import(pathToFileURL(join(project, 'owned.config.ts')).href)) as { default: OwnedConfig }
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'test'
    assert.deepEqual(await config.default.authenticate(fakeContext({ 'x-user-id': 'u1', 'x-user-role': 'admin' })), {
      id: 'u1',
      role: 'admin',
    })
    assert.deepEqual(await config.default.authenticate(fakeContext({ 'x-user-id': 'u2' })), { id: 'u2', role: 'user' })
    assert.equal(await config.default.authenticate(fakeContext({})), null)
    process.env.NODE_ENV = 'production'
    assert.equal(await config.default.authenticate(fakeContext({ 'x-user-id': 'u1' })), null)
  } finally {
    process.env.NODE_ENV = previous
  }
})

test('owned init rejects extra arguments', () => {
  const { code, stderr } = owned(freshProject(), 'init', '--force')
  assert.equal(code, 2)
  assert.match(stderr, /unknown option --force/)
})
