import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const OWNED_BIN = join(REPO_ROOT, 'bin', 'owned.ts')

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: withoutOwnedCheck() })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${result.stderr}${result.stdout}`)
  }
  return result.stdout
}

function withoutOwnedCheck(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.OWNED_CHECK
  return env
}

function git(cwd: string, ...args: string[]): string {
  return run('git', ['-c', 'user.name=owned-eval', '-c', 'user.email=owned-eval@localhost', ...args], cwd)
}

function linkDependencies(project: string): void {
  const modules = join(project, 'node_modules')
  mkdirSync(join(modules, '@types'), { recursive: true })
  mkdirSync(join(modules, '.bin'), { recursive: true })
  symlinkSync(REPO_ROOT, join(modules, 'owned'), 'dir')
  symlinkSync(join(REPO_ROOT, 'node_modules', 'typescript'), join(modules, 'typescript'), 'dir')
  symlinkSync(join(REPO_ROOT, 'node_modules', '@types', 'node'), join(modules, '@types', 'node'), 'dir')
  symlinkSync(OWNED_BIN, join(modules, '.bin', 'owned'))
}

export function createProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'owned-eval-'))
  run(process.execPath, [OWNED_BIN, 'init'], project)
  linkDependencies(project)
  git(project, 'init', '--quiet')
  git(project, 'add', '--all')
  git(project, 'commit', '--quiet', '--message', 'owned init')
  return project
}

export function touchedFiles(project: string): string[] {
  return git(project, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3))
    .sort()
}

export function filesImportingZod(project: string): string[] {
  const routes = join(project, 'routes')
  return readdirSync(routes, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => /from\s+['"]zod['"]/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(project.length + 1))
    .sort()
}

export interface CheckJson {
  errors: number
  warnings: number
  unsafeCount: number
  routes: Array<{ method: string; path: string; auth: string | null; owner: string | null }>
  violations: unknown[]
}

export function checkProject(project: string): CheckJson {
  const result = spawnSync(process.execPath, [OWNED_BIN, 'check', '--json'], { cwd: project, encoding: 'utf8', env: withoutOwnedCheck() })
  return JSON.parse(result.stdout) as CheckJson
}
