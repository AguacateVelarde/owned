import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { formatHuman, formatJson } from './check/format.ts'
import { runCheck } from './check/run.ts'
import { projectFiles } from './init/templates.ts'
import { writeProject, type WriteResult } from './init/write.ts'

export interface Io {
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

export const USAGE = 'usage: owned init\n       owned check [--json]'

type Command = { kind: 'check'; json: boolean } | { kind: 'init' } | { kind: 'usage-error'; message: string }

const EXIT_OK = 0
const EXIT_VIOLATIONS = 1
const EXIT_USAGE = 2

function usageError(message: string): Command {
  return { kind: 'usage-error', message: `${message}\n${USAGE}` }
}

export function parseArgs(args: string[]): Command {
  const [command, ...flags] = args
  if (command === undefined) return { kind: 'usage-error', message: USAGE }
  if (command === 'init') {
    const [extra] = flags
    return extra === undefined ? { kind: 'init' } : usageError(`unknown option ${extra}`)
  }
  if (command !== 'check') return usageError(`unknown command ${command}`)
  const unknown = flags.find((flag) => flag !== '--json')
  if (unknown !== undefined) return usageError(`unknown option ${unknown}`)
  return { kind: 'check', json: flags.includes('--json') }
}

function ownedVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return manifest.version
}

function formatInit(result: WriteResult): string {
  const lines = [
    ...result.created.map((path) => `created ${path}`),
    ...result.skipped.map((path) => `skipped ${path} (already exists)`),
  ]
  return `${lines.join('\n')}\n\nnext:\n  npm install\n  npx owned check\n`
}

async function init(io: Io): Promise<number> {
  const result = await writeProject(io.cwd, projectFiles(basename(io.cwd), ownedVersion()))
  io.out(formatInit(result))
  return EXIT_OK
}

async function check(io: Io, json: boolean): Promise<number> {
  process.env.OWNED_CHECK = '1'
  const outcome = await runCheck(io.cwd)
  if (outcome.kind === 'no-routes') {
    io.err(`no routes/ directory in ${io.cwd}; run owned from your project root\n`)
    return EXIT_USAGE
  }
  const report = formatJson(outcome.result)
  io.out(json ? `${JSON.stringify(report, null, 2)}\n` : formatHuman(outcome.result))
  return report.ok ? EXIT_OK : EXIT_VIOLATIONS
}

export async function main(args: string[], io: Io): Promise<number> {
  const command = parseArgs(args)
  if (command.kind === 'usage-error') {
    io.err(`${command.message}\n`)
    return EXIT_USAGE
  }
  return command.kind === 'init' ? init(io) : check(io, command.json)
}
