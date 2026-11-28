import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeAgent } from '../../evals/agent-crud/agents.ts'
import { touchedFiles } from '../../evals/agent-crud/project.ts'
import { gatePasses, runEval } from '../../evals/agent-crud/run.ts'

const solution = (name: string) => fileURLToPath(new URL(`../fixtures/eval-solutions/${name}`, import.meta.url))

test('a compliant agent passes every run and the gate', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('good')), runs: 2 })
  assert.deepEqual(summary.runs.map((r) => [r.passed, r.reasons]), [
    [true, []],
    [true, []],
  ])
  assert.equal(summary.passedRuns, 2)
  assert.equal(summary.gatePassed, true)
  assert.deepEqual(summary.runs[0]?.touched.sort(), [
    'db.ts',
    'routes/comments.$id.delete.ts',
    'routes/comments.$id.get.ts',
    'routes/comments.$id.patch.ts',
    'routes/comments.get.ts',
    'routes/comments.post.ts',
  ])
})

test('a public list that passes owned check still fails the eval', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('public-list')), runs: 1 })
  const [run] = summary.runs
  assert.equal(run?.check.errors, 0)
  assert.equal(run?.passed, false)
  assert.deepEqual(run?.reasons, ["GET /comments must be auth 'user' (got public)", 'GET /comments must declare an owner'])
  assert.equal(summary.gatePassed, false)
})

test('an agent that tampers with authentication fails the eval', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('tampered-config')), runs: 1 })
  assert.deepEqual(summary.runs[0]?.reasons, ['the agent modified owned.config.ts'])
})

test('the gate needs two thirds of the runs to pass', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('good')), runs: 1 })
  assert.equal(summary.gatePassed, true)
})

test('--keep leaves the project on disk for inspection', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('good')), runs: 1, keep: true })
  const project = summary.runs[0]?.project
  assert.ok(project !== undefined && existsSync(join(project, 'routes', 'comments.get.ts')))
  rmSync(project, { recursive: true, force: true })
})

test('without --keep the project is removed', async () => {
  const summary = await runEval({ agent: fakeAgent(solution('good')), runs: 1 })
  assert.equal(summary.runs[0]?.project, undefined)
})

test('gatePasses needs at least two thirds and at least one run', () => {
  assert.deepEqual([gatePasses(2, 3), gatePasses(1, 3), gatePasses(3, 3), gatePasses(0, 0)], [true, false, true, false])
})

test('a git failure is surfaced, not swallowed', () => {
  const notARepo = mkdtempSync(join(tmpdir(), 'owned-not-git-'))
  try {
    assert.throws(() => touchedFiles(notARepo), /git .*status.* failed/)
  } finally {
    rmSync(notARepo, { recursive: true, force: true })
  }
})
