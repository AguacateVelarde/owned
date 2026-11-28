import { spawn } from 'node:child_process'
import { cp } from 'node:fs/promises'
import { basename } from 'node:path'

export interface AgentStats {
  turns: number | null
  durationMs: number | null
  costUsd: number | null
  agentError: boolean
}

export interface Agent {
  name: string
  run: (projectDir: string, prompt: string) => Promise<AgentStats | undefined>
}

export function fakeAgent(solutionDir: string): Agent {
  return {
    name: `fake:${basename(solutionDir)}`,
    run: async (projectDir) => {
      await cp(solutionDir, projectDir, { recursive: true })
      return undefined
    },
  }
}

export interface ClaudeOptions {
  maxBudgetUsd: number
  model?: string
  timeoutMs?: number
}

const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(npx owned check:*)']

export function claudeArgs(prompt: string, options: ClaudeOptions): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd',
    String(options.maxBudgetUsd),
    ...(options.model === undefined ? [] : ['--model', options.model]),
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--',
    prompt,
  ]
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseClaudeResult(stdout: string): AgentStats {
  try {
    const result = JSON.parse(stdout) as Record<string, unknown>
    return {
      turns: numberOrNull(result.num_turns),
      durationMs: numberOrNull(result.duration_ms),
      costUsd: numberOrNull(result.total_cost_usd),
      agentError: result.is_error === true,
    }
  } catch {
    return { turns: null, durationMs: null, costUsd: null, agentError: true }
  }
}

const AGENT_TIMEOUT_MS = 20 * 60 * 1000

function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.OWNED_CHECK
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  return env
}

export function claudeAgent(options: ClaudeOptions): Agent {
  return {
    name: options.model === undefined ? 'claude' : `claude:${options.model}`,
    run: (projectDir, prompt) =>
      new Promise((resolve) => {
        const child = spawn('claude', claudeArgs(prompt, options), {
          cwd: projectDir,
          env: agentEnv(),
          stdio: ['ignore', 'pipe', 'inherit'],
          signal: AbortSignal.timeout(options.timeoutMs ?? AGENT_TIMEOUT_MS),
        })
        let stdout = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.on('error', () => resolve({ turns: null, durationMs: null, costUsd: null, agentError: true }))
        child.on('close', (code) => {
          const stats = parseClaudeResult(stdout)
          resolve(code === 0 ? stats : { ...stats, agentError: true })
        })
      }),
  }
}
