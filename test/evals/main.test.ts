import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSummary, parseEvalArgs } from '../../evals/agent-crud/main.ts'
import type { EvalSummary } from '../../evals/agent-crud/run.ts'

test('defaults: claude, 3 runs, $2 budget per run', () => {
  assert.deepEqual(parseEvalArgs([]), { kind: 'claude', runs: 3, maxBudgetUsd: 2, model: undefined, keep: false })
})

test('every option can be set', () => {
  assert.deepEqual(parseEvalArgs(['--runs', '1', '--budget', '0.5', '--model', 'claude-haiku-5-5', '--keep']), {
    kind: 'claude',
    runs: 1,
    maxBudgetUsd: 0.5,
    model: 'claude-haiku-5-5',
    keep: true,
  })
})

test('a fake agent runs a solution directory instead of claude', () => {
  assert.deepEqual(parseEvalArgs(['--fake', 'test/fixtures/eval-solutions/good', '--runs', '1']), {
    kind: 'fake',
    solutionDir: 'test/fixtures/eval-solutions/good',
    runs: 1,
    keep: false,
  })
})

test('bad arguments are rejected with a reason', () => {
  assert.deepEqual(parseEvalArgs(['--runs', '0']), { kind: 'error', message: '--runs must be a positive integer' })
  assert.deepEqual(parseEvalArgs(['--budget', 'lots']), { kind: 'error', message: '--budget must be a positive number of dollars' })
  assert.deepEqual(parseEvalArgs(['--yolo']), { kind: 'error', message: 'unknown option --yolo' })
  assert.deepEqual(parseEvalArgs(['--model']), { kind: 'error', message: '--model needs a value' })
})

test('the summary shows each run and the gate', () => {
  const summary: EvalSummary = {
    agent: 'claude',
    passedRuns: 1,
    gatePassed: false,
    runs: [
      {
        run: 1,
        agent: 'claude',
        passed: true,
        reasons: [],
        check: { errors: 0, warnings: 0, unsafeCount: 0 },
        touched: ['db.ts'],
        zodImports: [],
        stats: { turns: 14, durationMs: 95000, costUsd: 0.61, agentError: false },
        project: undefined,
        violations: [],
      },
      {
        run: 2,
        agent: 'claude',
        passed: false,
        reasons: ['missing route PATCH /comments/:id'],
        check: { errors: 1, warnings: 0, unsafeCount: 0 },
        touched: ['db.ts'],
        zodImports: [],
        stats: { turns: null, durationMs: null, costUsd: null, agentError: true },
        project: '/tmp/owned-eval-x',
        violations: [],
      },
    ],
  }
  const out = formatSummary(summary)
  assert.match(out, /run 1 {2}PASS {2}0 errors · 0 warnings · 0 unsafe {2}14 turns · 95s · \$0\.61/)
  assert.match(out, /run 2 {2}FAIL {2}1 error · 0 warnings · 0 unsafe {2}agent error\n {4}- missing route PATCH \/comments\/:id\n {4}kept at \/tmp\/owned-eval-x/)
  assert.match(out, /compliance gate: FAIL \(1\/2 runs passed, needs 2\/3\)/)
  assert.match(out, /total cost: \$0\.61/)
})

test('stats with unknown values print a question mark', () => {
  const run = {
    run: 1,
    agent: 'claude',
    passed: false,
    reasons: [],
    check: { errors: 0, warnings: 1, unsafeCount: 0 },
    touched: [],
    zodImports: [],
    stats: { turns: null, durationMs: null, costUsd: null, agentError: false },
    project: undefined,
    violations: [],
  }
  const out = formatSummary({ agent: 'claude', runs: [run], passedRuns: 0, gatePassed: false })
  assert.match(out, /run 1 {2}FAIL {2}0 errors · 1 warning · 0 unsafe {2}\? turns · \?s · \$\?/)
  assert.doesNotMatch(out, /total cost/)
})

test('a fake run prints no stats and no cost', () => {
  const run = {
    run: 1,
    agent: 'fake:good',
    passed: true,
    reasons: [],
    check: { errors: 0, warnings: 0, unsafeCount: 0 },
    touched: [],
    zodImports: [],
    stats: undefined,
    project: undefined,
    violations: [],
  }
  const out = formatSummary({ agent: 'fake:good', runs: [run], passedRuns: 1, gatePassed: true })
  assert.match(out, /run 1 {2}PASS {2}0 errors · 0 warnings · 0 unsafe\n/)
  assert.match(out, /compliance gate: PASS/)
})

test('--keep works with a fake agent', () => {
  assert.deepEqual(parseEvalArgs(['--keep', '--fake', 'dir']), { kind: 'fake', solutionDir: 'dir', runs: 3, keep: true })
})
