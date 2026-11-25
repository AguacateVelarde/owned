import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeRoute, analyzeRouteFile } from '../contract/analyze.ts'
import type { Violation } from '../contract/rules.ts'
import type { CheckResult, RouteSummary } from './format.ts'
import { translateLoadError, type LoadFailure } from './load-error.ts'

export type CheckOutcome = { kind: 'no-routes'; routesDir: string } | { kind: 'checked'; result: CheckResult }

type Loaded = { ok: true; def: unknown } | { ok: false; failure: LoadFailure }

async function listRouteFiles(routesDir: string): Promise<string[]> {
  const entries = await readdir(routesDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(routesDir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

function asLoadFailure(error: unknown): LoadFailure {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return { name: error.name, code: typeof code === 'string' ? code : undefined, message: error.message }
  }
  return { name: 'Error', code: undefined, message: String(error) }
}

async function loadDefaultExport(path: string): Promise<Loaded> {
  try {
    const mod = (await import(pathToFileURL(path).href)) as { default?: unknown }
    return { ok: true, def: mod.default }
  } catch (error) {
    return { ok: false, failure: asLoadFailure(error) }
  }
}

async function checkFile(root: string, routesDir: string, file: string): Promise<{ summary?: RouteSummary; violations: Violation[] }> {
  const fileAnalysis = analyzeRouteFile(file)
  const summary =
    fileAnalysis.route === undefined || fileAnalysis.shape === undefined
      ? undefined
      : { file, method: fileAnalysis.route.method, path: fileAnalysis.route.path, shape: fileAnalysis.shape }
  const withSummary = (violations: Violation[]) => (summary === undefined ? { violations } : { summary, violations })

  if (!file.endsWith('.ts')) return withSummary(fileAnalysis.violations)

  const loaded = await loadDefaultExport(join(routesDir, file))
  if (!loaded.ok) {
    return withSummary([...fileAnalysis.violations, translateLoadError(root, file, loaded.failure, existsSync)])
  }
  return withSummary(analyzeRoute(file, loaded.def).violations)
}

export async function runCheck(root: string): Promise<CheckOutcome> {
  const routesDir = join(root, 'routes')
  if (!existsSync(routesDir)) return { kind: 'no-routes', routesDir }

  const routes: RouteSummary[] = []
  const violations: Violation[] = []
  for (const file of await listRouteFiles(routesDir)) {
    const checked = await checkFile(root, routesDir, file)
    if (checked.summary !== undefined) routes.push(checked.summary)
    violations.push(...checked.violations)
  }
  return { kind: 'checked', result: { routes, violations } }
}
