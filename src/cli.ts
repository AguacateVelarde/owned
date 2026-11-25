import { formatHuman, formatJson } from './check/format.ts'
import { runCheck } from './check/run.ts'

export interface Io {
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

export const USAGE = 'usage: owned check [--json]'

type Command = { kind: 'check'; json: boolean } | { kind: 'usage-error'; message: string }

const EXIT_OK = 0
const EXIT_VIOLATIONS = 1
const EXIT_USAGE = 2

export function parseArgs(args: string[]): Command {
  const [command, ...flags] = args
  if (command !== 'check') {
    return { kind: 'usage-error', message: command === undefined ? USAGE : `unknown command ${command}\n${USAGE}` }
  }
  const unknown = flags.find((flag) => flag !== '--json')
  if (unknown !== undefined) return { kind: 'usage-error', message: `unknown option ${unknown}\n${USAGE}` }
  return { kind: 'check', json: flags.includes('--json') }
}

export async function main(args: string[], io: Io): Promise<number> {
  const command = parseArgs(args)
  if (command.kind === 'usage-error') {
    io.err(`${command.message}\n`)
    return EXIT_USAGE
  }
  process.env.OWNED_CHECK = '1'
  const outcome = await runCheck(io.cwd)
  if (outcome.kind === 'no-routes') {
    io.err(`no routes/ directory in ${io.cwd}; run owned from your project root\n`)
    return EXIT_USAGE
  }
  const report = formatJson(outcome.result)
  io.out(command.json ? `${JSON.stringify(report, null, 2)}\n` : formatHuman(outcome.result))
  return report.ok ? EXIT_OK : EXIT_VIOLATIONS
}
