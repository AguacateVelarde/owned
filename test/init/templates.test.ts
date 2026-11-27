import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES } from '../../src/contract/rules.ts'
import { VALID_PATTERNS } from '../../src/contract/route-file.ts'
import { projectFiles, ROUTE_TEMPLATES } from '../../src/init/templates.ts'

const files = projectFiles('notes-api', '1.2.3')
const content = (path: string) => {
  const file = files.find((f) => f.path === path)
  assert.ok(file, `missing ${path}`)
  return file.content
}

test('init generates the project skeleton', () => {
  assert.deepEqual(files.map((f) => f.path), [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    'owned.config.ts',
    'db.ts',
    'routes/health.get.ts',
    'AGENTS.md',
    'CLAUDE.md',
  ])
  for (const file of files) assert.ok(file.content.endsWith('\n'), `${file.path} ends with a newline`)
})

test('package.json is an ESM project that depends on owned and typescript', () => {
  const pkg = JSON.parse(content('package.json')) as Record<string, unknown>
  assert.equal(pkg.name, 'notes-api')
  assert.equal(pkg.type, 'module')
  assert.deepEqual(pkg.engines, { node: '>=22.18' })
  assert.deepEqual(pkg.dependencies, { owned: '^1.2.3' })
  assert.ok((pkg.devDependencies as Record<string, string>).typescript)
  assert.equal((pkg.scripts as Record<string, string>).check, 'owned check')
})

test('tsconfig.json turns on the flags Node type stripping needs', () => {
  const options = (JSON.parse(content('tsconfig.json')) as { compilerOptions: Record<string, unknown> }).compilerOptions
  for (const flag of ['erasableSyntaxOnly', 'verbatimModuleSyntax', 'allowImportingTsExtensions', 'noEmit', 'strict']) {
    assert.equal(options[flag], true, flag)
  }
  assert.equal(options.module, 'nodenext')
})

test('AGENTS.md lists every rule the checker enforces', () => {
  const agents = content('AGENTS.md')
  for (const [id, rule] of Object.entries(RULES)) {
    assert.ok(agents.includes(`| ${rule.number} | \`${id}\` | ${rule.severity} | ${rule.title} |`), id)
  }
})

test('AGENTS.md shows the file convention and every route template', () => {
  const agents = content('AGENTS.md')
  for (const pattern of VALID_PATTERNS) assert.ok(agents.includes(pattern), pattern)
  for (const template of ROUTE_TEMPLATES) {
    assert.ok(agents.includes(`routes/${template.file}`), template.file)
    assert.ok(agents.includes(template.content), template.file)
  }
})

test('AGENTS.md tells the agent how to finish', () => {
  const agents = content('AGENTS.md')
  assert.match(agents, /npx owned check --json/)
  assert.match(agents, /0 errors and 0 warnings/)
  assert.match(agents, /import \{ defineRoute, z \} from 'owned'/)
  assert.match(agents, /'\.\.\/db\.ts'/)
  assert.match(agents, /x-user-id/)
  assert.match(agents, /unsafe/)
})

test('CLAUDE.md points at AGENTS.md', () => {
  assert.match(content('CLAUDE.md'), /AGENTS\.md/)
})

test('route templates cover all four shapes', () => {
  assert.deepEqual(ROUTE_TEMPLATES.map((t) => t.file).sort(), [
    'health.get.ts',
    'notes.$id.delete.ts',
    'notes.get.ts',
    'notes.post.ts',
  ])
  assert.equal(content('routes/health.get.ts'), ROUTE_TEMPLATES.find((t) => t.file === 'health.get.ts')?.content)
})
