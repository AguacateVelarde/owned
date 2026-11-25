import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { violation, type Violation } from '../contract/rules.ts'
import { ENUM_FIX } from './load-error.ts'

const run = promisify(execFile)

const WITH_FILE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const WITHOUT_FILE = /^error (TS\d+): (.*)$/
const IMPORT_EXTENSION_CODES = new Set(['TS2835', 'TS2834', 'TS5097'])

const TSCONFIG_FIX = `create tsconfig.json (owned init writes one):
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}`

interface Diagnostic {
  file: string
  position: string | undefined
  code: string
  lines: string[]
}

function fixFor(diagnostic: Diagnostic): string {
  if (diagnostic.code === 'TS1294') return ENUM_FIX
  if (IMPORT_EXTENSION_CODES.has(diagnostic.code)) return "add the .ts extension to the relative import, e.g. '../db.ts'"
  const where = diagnostic.position === undefined ? diagnostic.file : `${diagnostic.file}:${diagnostic.position}`
  return `fix the type error at ${where}`
}

function toViolation(diagnostic: Diagnostic): Violation {
  const [first = '', ...rest] = diagnostic.lines
  const head = diagnostic.position === undefined ? `${diagnostic.code} ${first}` : `${diagnostic.position} ${diagnostic.code} ${first}`
  return violation('typecheck', diagnostic.file, [head, ...rest].join('\n'), fixFor(diagnostic))
}

function startDiagnostic(line: string): Diagnostic | undefined {
  const withFile = WITH_FILE.exec(line)
  if (withFile !== null) {
    const [, file = '', row, col, code = '', text = ''] = withFile
    return { file, position: `${row}:${col}`, code, lines: [text] }
  }
  const withoutFile = WITHOUT_FILE.exec(line)
  if (withoutFile !== null) {
    const [, code = '', text = ''] = withoutFile
    return { file: 'tsconfig.json', position: undefined, code, lines: [text] }
  }
  return undefined
}

export function parseTscOutput(output: string): Violation[] {
  const diagnostics: Diagnostic[] = []
  for (const line of output.split('\n')) {
    const started = startDiagnostic(line)
    if (started !== undefined) {
      diagnostics.push(started)
    } else if (line.startsWith(' ') && diagnostics.length > 0) {
      diagnostics[diagnostics.length - 1]?.lines.push(line)
    }
  }
  return diagnostics.map(toViolation)
}

export function resolveProjectTsc(root: string): string | undefined {
  try {
    const require = createRequire(join(root, 'package.json'))
    const manifestPath = require.resolve('typescript/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: { tsc?: string } }
    return manifest.bin?.tsc === undefined ? undefined : join(dirname(manifestPath), manifest.bin.tsc)
  } catch {
    return undefined
  }
}

export interface TypecheckOptions {
  resolveTsc?: (root: string) => string | undefined
}

function skipped(message: string, fix: string): Violation[] {
  return [violation('typecheck-skipped', 'tsconfig.json', message, fix)]
}

async function tscOutput(tsc: string, root: string): Promise<string> {
  try {
    await run(process.execPath, [tsc, '--noEmit', '-p', root, '--pretty', 'false'], { cwd: root })
    return ''
  } catch (error) {
    return String((error as { stdout?: unknown }).stdout ?? '')
  }
}

export async function runTypecheck(root: string, options: TypecheckOptions = {}): Promise<Violation[]> {
  if (!existsSync(join(root, 'tsconfig.json'))) {
    return skipped('no tsconfig.json, so type errors were not checked', TSCONFIG_FIX)
  }
  const tsc = (options.resolveTsc ?? resolveProjectTsc)(root)
  if (tsc === undefined) {
    return skipped('typescript is not installed in this project, so type errors were not checked', 'npm install --save-dev typescript')
  }
  return parseTscOutput(await tscOutput(tsc, root))
}
