import type { AgentStats } from './agents.ts'
import type { EvalSummary, RunResult } from './run.ts'

export type EvalArgs =
  | { kind: 'claude'; runs: number; maxBudgetUsd: number; model: string | undefined; keep: boolean }
  | { kind: 'fake'; solutionDir: string; runs: number; keep: boolean }
  | { kind: 'error'; message: string }

const DEFAULT_RUNS = 3
const DEFAULT_BUDGET_USD = 2

interface Collected {
  runs: number
  maxBudgetUsd: number
  model: string | undefined
  fake: string | undefined
  keep: boolean
}

function positiveInteger(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function applyOption(flag: string, value: string | undefined, into: Collected): string | undefined {
  if (flag === '--runs') {
    const runs = positiveInteger(value)
    if (runs === undefined) return '--runs must be a positive integer'
    into.runs = runs
  } else if (flag === '--budget') {
    const budget = positiveNumber(value)
    if (budget === undefined) return '--budget must be a positive number of dollars'
    into.maxBudgetUsd = budget
  } else if (flag === '--model' || flag === '--fake') {
    if (value === undefined) return `${flag} needs a value`
    if (flag === '--model') into.model = value
    else into.fake = value
  } else {
    return `unknown option ${flag}`
  }
  return undefined
}

export function parseEvalArgs(args: string[]): EvalArgs {
  const collected: Collected = { runs: DEFAULT_RUNS, maxBudgetUsd: DEFAULT_BUDGET_USD, model: undefined, fake: undefined, keep: false }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] ?? ''
    if (flag === '--keep') {
      collected.keep = true
      continue
    }
    const problem = applyOption(flag, args[i + 1], collected)
    if (problem !== undefined) return { kind: 'error', message: problem }
    i++
  }
  if (collected.fake !== undefined) {
    return { kind: 'fake', solutionDir: collected.fake, runs: collected.runs, keep: collected.keep }
  }
  return { kind: 'claude', runs: collected.runs, maxBudgetUsd: collected.maxBudgetUsd, model: collected.model, keep: collected.keep }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function formatStats(stats: AgentStats | undefined): string {
  if (stats === undefined) return ''
  if (stats.agentError) return 'agent error'
  const seconds = stats.durationMs === null ? '?' : String(Math.round(stats.durationMs / 1000))
  const cost = stats.costUsd === null ? '?' : stats.costUsd.toFixed(2)
  return `${stats.turns ?? '?'} turns · ${seconds}s · $${cost}`
}

function formatRun(run: RunResult): string {
  const counts = `${plural(run.check.errors, 'error')} · ${plural(run.check.warnings, 'warning')} · ${run.check.unsafeCount} unsafe`
  const head = [`run ${run.run}`, run.passed ? 'PASS' : 'FAIL', counts, formatStats(run.stats)].filter((p) => p !== '').join('  ')
  const details = [...run.reasons.map((reason) => `    - ${reason}`), ...(run.project === undefined ? [] : [`    kept at ${run.project}`])]
  return [head, ...details].join('\n')
}

export function formatSummary(summary: EvalSummary): string {
  const gate = `compliance gate: ${summary.gatePassed ? 'PASS' : 'FAIL'} (${summary.passedRuns}/${summary.runs.length} runs passed, needs 2/3)`
  const costs = summary.runs.map((r) => r.stats?.costUsd).filter((c): c is number => typeof c === 'number')
  const total = costs.length === 0 ? [] : [`total cost: $${costs.reduce((a, b) => a + b, 0).toFixed(2)}`]
  return [`agent: ${summary.agent}`, '', ...summary.runs.map(formatRun), '', gate, ...total].join('\n') + '\n'
}
