import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeArgs, parseClaudeResult } from '../../evals/agent-crud/agents.ts'

const args = claudeArgs('build comments', { maxBudgetUsd: 2 })

test('claude runs headless with a JSON result', () => {
  assert.equal(args[0], '-p')
  assert.equal(args[args.length - 1], 'build comments')
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json'])
})

test('claude is sandboxed: project settings only, no MCP servers, no session saved, capped budget', () => {
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'project'])
  assert.ok(args.includes('--strict-mcp-config'))
  assert.ok(args.includes('--no-session-persistence'))
  assert.deepEqual(args.slice(args.indexOf('--max-budget-usd'), args.indexOf('--max-budget-usd') + 2), ['--max-budget-usd', '2'])
})

test('claude may only read, write files and run owned check', () => {
  const start = args.indexOf('--allowedTools') + 1
  const tools = args.slice(start, args.indexOf('--', start))
  assert.deepEqual(tools, ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(npx owned check:*)'])
  assert.ok(!args.includes('--dangerously-skip-permissions'))
  assert.ok(!args.includes('bypassPermissions'))
})

test('the prompt is passed after -- so it cannot be read as a flag', () => {
  const dashed = claudeArgs('--help', { maxBudgetUsd: 1 })
  assert.equal(dashed[0], '-p')
  assert.equal(dashed[dashed.length - 1], '--help')
  assert.equal(dashed[dashed.length - 2], '--')
})

test('the model can be chosen', () => {
  const withModel = claudeArgs('x', { maxBudgetUsd: 1, model: 'claude-sonnet-5-5' })
  assert.deepEqual(withModel.slice(withModel.indexOf('--model'), withModel.indexOf('--model') + 2), ['--model', 'claude-sonnet-5-5'])
})

test('the JSON result is turned into run stats', () => {
  const stats = parseClaudeResult(JSON.stringify({ num_turns: 12, duration_ms: 90000, total_cost_usd: 0.42, is_error: false }))
  assert.deepEqual(stats, { turns: 12, durationMs: 90000, costUsd: 0.42, agentError: false })
})

test('an unreadable result is reported, not hidden', () => {
  assert.deepEqual(parseClaudeResult('not json'), { turns: null, durationMs: null, costUsd: null, agentError: true })
})
