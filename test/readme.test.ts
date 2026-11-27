import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { USAGE } from '../src/cli.ts'
import { VALID_PATTERNS } from '../src/contract/route-file.ts'
import { rulesTable } from '../src/init/agents-md.ts'
import { ROUTE_TEMPLATES } from '../src/init/templates.ts'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('README lists exactly the rules owned check enforces', () => {
  assert.ok(readme.includes(rulesTable()), 'regenerate the rules table from RULES')
})

test('README shows the current CLI usage', () => {
  assert.ok(readme.includes(USAGE))
})

test('README documents the route file convention', () => {
  for (const pattern of VALID_PATTERNS) assert.ok(readme.includes(pattern), pattern)
})

test('README examples are the same templates owned init ships', () => {
  for (const template of ROUTE_TEMPLATES) assert.ok(readme.includes(template.content.trimEnd()), template.file)
})
