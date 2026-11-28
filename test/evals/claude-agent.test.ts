import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeAgent } from '../../evals/agent-crud/agents.ts'

function withFakeClaude(script: string, run: (binDir: string, workDir: string) => Promise<void>) {
  return async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'owned-fake-claude-'))
    const workDir = mkdtempSync(join(tmpdir(), 'owned-fake-work-'))
    const claude = join(binDir, 'claude')
    writeFileSync(claude, `#!/usr/bin/env node\n${script}\n`)
    chmodSync(claude, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${binDir}:${previousPath ?? ''}`
    process.env.OWNED_CHECK = '1'
    process.env.CLAUDECODE = '1'
    try {
      await run(binDir, workDir)
    } finally {
      process.env.PATH = previousPath
      delete process.env.OWNED_CHECK
      delete process.env.CLAUDECODE
      rmSync(binDir, { recursive: true, force: true })
      rmSync(workDir, { recursive: true, force: true })
    }
  }
}

const RECORDING_CLAUDE = `
const fs = require('node:fs')
fs.writeFileSync('seen.json', JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  ownedCheck: process.env.OWNED_CHECK ?? null,
  claudeCode: process.env.CLAUDECODE ?? null,
}))
process.stdout.write(JSON.stringify({ num_turns: 7, duration_ms: 42000, total_cost_usd: 0.33, is_error: false }))
`

test(
  'claudeAgent runs claude in the project with a clean environment and reads its stats',
  withFakeClaude(RECORDING_CLAUDE, async (_bin, workDir) => {
    const stats = await claudeAgent({ maxBudgetUsd: 1.5 }).run(workDir, 'build comments')
    assert.deepEqual(stats, { turns: 7, durationMs: 42000, costUsd: 0.33, agentError: false })
    const seen = JSON.parse(readFileSync(join(workDir, 'seen.json'), 'utf8')) as {
      args: string[]
      cwd: string
      ownedCheck: string | null
      claudeCode: string | null
    }
    assert.equal(seen.args.at(-1), 'build comments')
    assert.ok(seen.args.includes('1.5'))
    assert.match(seen.cwd, /owned-fake-work-/)
    assert.equal(seen.ownedCheck, null)
    assert.equal(seen.claudeCode, null)
  }),
)

test(
  'a claude process that crashes is an agent error, not a pass',
  withFakeClaude('process.exit(3)', async (_bin, workDir) => {
    assert.deepEqual(await claudeAgent({ maxBudgetUsd: 1 }).run(workDir, 'x'), {
      turns: null,
      durationMs: null,
      costUsd: null,
      agentError: true,
    })
  }),
)

const activeTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

test('a missing claude binary is an agent error and leaves no timer behind', async () => {
  const previousPath = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'owned-empty-path-'))
  try {
    const before = activeTimers()
    const stats = await claudeAgent({ maxBudgetUsd: 1 }).run(tmpdir(), 'x')
    assert.equal(stats?.agentError, true)
    assert.equal(activeTimers(), before)
  } finally {
    rmSync(process.env.PATH, { recursive: true, force: true })
    process.env.PATH = previousPath
  }
})

test(
  'a claude that never finishes is stopped at the timeout and counted as an agent error',
  withFakeClaude('setInterval(() => {}, 1000)', async (_bin, workDir) => {
    const started = Date.now()
    const stats = await claudeAgent({ maxBudgetUsd: 1, timeoutMs: 300 }).run(workDir, 'x')
    assert.equal(stats?.agentError, true)
    assert.ok(Date.now() - started < 5000)
  }),
)

test(
  'a claude that fails after printing its result keeps the stats and is an agent error',
  withFakeClaude(
    "process.stdout.write(JSON.stringify({ num_turns: 30, duration_ms: 600000, total_cost_usd: 2.01, is_error: true })); process.exit(1)",
    async (_bin, workDir) => {
      assert.deepEqual(await claudeAgent({ maxBudgetUsd: 2 }).run(workDir, 'x'), {
        turns: 30,
        durationMs: 600000,
        costUsd: 2.01,
        agentError: true,
      })
    },
  ),
)

test(
  'a non-zero exit is an agent error even if the result claims success',
  withFakeClaude(
    "process.stdout.write(JSON.stringify({ num_turns: 3, duration_ms: 1000, total_cost_usd: 0.1, is_error: false })); process.exit(2)",
    async (_bin, workDir) => {
      assert.equal((await claudeAgent({ maxBudgetUsd: 2 }).run(workDir, 'x'))?.agentError, true)
    },
  ),
)

test('the agent name includes the model when one is chosen', () => {
  assert.equal(claudeAgent({ maxBudgetUsd: 1 }).name, 'claude')
  assert.equal(claudeAgent({ maxBudgetUsd: 1, model: 'claude-haiku-5-5' }).name, 'claude:claude-haiku-5-5')
})
