import { EXPECTED_ROUTES, PROTECTED_FILES, type ExpectedRoute } from './spec.ts'

export interface RouteInfo {
  method: string
  path: string
  auth: string | null
  owner: string | null
}

export interface CheckCounts {
  errors: number
  warnings: number
  unsafeCount: number
  routes: RouteInfo[]
}

export interface RunEvidence {
  report: CheckCounts
  touched: string[]
  zodImports: string[]
}

export interface Score {
  passed: boolean
  reasons: string[]
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function samePath(a: string, b: string): boolean {
  const normalize = (path: string) => path.replace(/:[^/]+/g, ':param')
  return normalize(a) === normalize(b)
}

function label(route: ExpectedRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`
}

function checkReasons(report: CheckCounts): string[] {
  return [
    ...(report.errors > 0 ? [`owned check reported ${plural(report.errors, 'error')}`] : []),
    ...(report.warnings > 0 ? [`owned check reported ${plural(report.warnings, 'warning')}`] : []),
    ...(report.unsafeCount > 0 ? [`the agent used unsafe ${plural(report.unsafeCount, 'time')}`] : []),
  ]
}

function routeReasons(expected: ExpectedRoute, routes: RouteInfo[]): string[] {
  const found = routes.find((r) => r.method === expected.method && samePath(r.path, expected.path))
  if (found === undefined) return [`missing route ${label(expected)}`]
  return [
    ...(found.auth === 'user' ? [] : [`${label(expected)} must be auth 'user' (got ${found.auth ?? 'unknown'})`]),
    ...(found.owner === null ? [`${label(expected)} must declare an owner`] : []),
  ]
}

export function scoreRun(evidence: RunEvidence): Score {
  const reasons = [
    ...checkReasons(evidence.report),
    ...EXPECTED_ROUTES.flatMap((expected) => routeReasons(expected, evidence.report.routes)),
    ...PROTECTED_FILES.filter((file) => evidence.touched.includes(file)).map((file) => `the agent modified ${file}`),
    ...evidence.zodImports.map((file) => `${file} imports zod directly instead of from 'owned'`),
  ]
  return { passed: reasons.length === 0, reasons }
}
