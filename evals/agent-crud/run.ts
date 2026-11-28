import { rm } from 'node:fs/promises'
import type { Agent, AgentStats } from './agents.ts'
import { checkProject, createProject, filesImportingZod, touchedFiles } from './project.ts'
import { scoreRun } from './score.ts'
import { PROMPT } from './spec.ts'

export interface RunResult {
  run: number
  agent: string
  passed: boolean
  reasons: string[]
  check: { errors: number; warnings: number; unsafeCount: number }
  touched: string[]
  zodImports: string[]
  stats: AgentStats | undefined
  project: string | undefined
  violations: unknown[]
}

export interface EvalSummary {
  agent: string
  runs: RunResult[]
  passedRuns: number
  gatePassed: boolean
}

export interface EvalOptions {
  agent: Agent
  runs: number
  keep?: boolean
}

async function oneRun(index: number, options: EvalOptions): Promise<RunResult> {
  const project = createProject()
  try {
    const stats = await options.agent.run(project, PROMPT)
    const report = checkProject(project)
    const touched = touchedFiles(project)
    const zodImports = filesImportingZod(project)
    const score = scoreRun({ report, touched, zodImports })
    return {
      run: index,
      agent: options.agent.name,
      passed: score.passed,
      reasons: score.reasons,
      check: { errors: report.errors, warnings: report.warnings, unsafeCount: report.unsafeCount },
      touched,
      zodImports,
      stats,
      project: options.keep === true ? project : undefined,
      violations: report.violations,
    }
  } finally {
    if (options.keep !== true) await rm(project, { recursive: true, force: true })
  }
}

export function gatePasses(passedRuns: number, runs: number): boolean {
  return runs > 0 && passedRuns * 3 >= runs * 2
}

export async function runEval(options: EvalOptions): Promise<EvalSummary> {
  const runs: RunResult[] = []
  for (let index = 1; index <= options.runs; index++) runs.push(await oneRun(index, options))
  const passedRuns = runs.filter((r) => r.passed).length
  return { agent: options.agent.name, runs, passedRuns, gatePassed: gatePasses(passedRuns, options.runs) }
}
