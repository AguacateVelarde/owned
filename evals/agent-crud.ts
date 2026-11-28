import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { claudeAgent, fakeAgent } from './agent-crud/agents.ts'
import { formatSummary, parseEvalArgs } from './agent-crud/main.ts'
import { REPO_ROOT } from './agent-crud/project.ts'
import { runEval } from './agent-crud/run.ts'

const args = parseEvalArgs(process.argv.slice(2))

if (args.kind === 'error') {
  process.stderr.write(`${args.message}\nusage: npm run eval -- [--runs N] [--budget USD] [--model ID] [--keep] [--fake DIR]\n`)
  process.exit(2)
}

const agent =
  args.kind === 'claude'
    ? claudeAgent(args.model === undefined ? { maxBudgetUsd: args.maxBudgetUsd } : { maxBudgetUsd: args.maxBudgetUsd, model: args.model })
    : fakeAgent(resolve(args.solutionDir))

if (args.kind === 'claude') {
  const ceiling = (args.runs * args.maxBudgetUsd).toFixed(2)
  process.stdout.write(`running ${agent.name} ${args.runs} times in fresh projects, up to $${args.maxBudgetUsd} per run ($${ceiling} max)\n\n`)
}

const summary = await runEval({ agent, runs: args.runs, keep: args.keep })
const resultsDir = join(REPO_ROOT, 'evals', 'results')
await mkdir(resultsDir, { recursive: true })
const resultsFile = join(resultsDir, `agent-crud-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
await writeFile(resultsFile, `${JSON.stringify(summary, null, 2)}\n`)

process.stdout.write(formatSummary(summary))
process.stdout.write(`results: ${resultsFile}\n`)
process.exitCode = summary.gatePassed ? 0 : 1
