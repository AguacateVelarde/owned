import type { Violation } from '../contract/rules.ts'
import type { Method, RouteShape } from '../types.ts'

export interface RouteSummary {
  file: string
  method: Method
  path: string
  shape: RouteShape
}

export interface CheckResult {
  routes: RouteSummary[]
  violations: Violation[]
}

export interface Counts {
  errors: number
  warnings: number
  unsafeCount: number
}

export interface JsonReport extends Counts {
  ok: boolean
  routes: RouteSummary[]
  violations: Violation[]
}

export function summarize(violations: Violation[]): Counts {
  return {
    errors: violations.filter((v) => v.severity === 'error').length,
    warnings: violations.filter((v) => v.severity === 'warning').length,
    unsafeCount: violations.filter((v) => v.id === 'unsafe-used').length,
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n')
}

function formatViolation(v: Violation): string {
  const mark = v.severity === 'error' ? '✗' : '⚠'
  return [`${mark} ${v.file}  [rule ${v.rule} ${v.id}]`, indent(v.message, 2), '  fix:', indent(v.fix, 4)].join('\n')
}

export function formatHuman(result: CheckResult): string {
  const errorsFirst = [
    ...result.violations.filter((v) => v.severity === 'error'),
    ...result.violations.filter((v) => v.severity === 'warning'),
  ]
  const counts = summarize(result.violations)
  const summary = [
    plural(result.routes.length, 'route'),
    plural(counts.errors, 'error'),
    plural(counts.warnings, 'warning'),
    `${counts.unsafeCount} unsafe`,
  ].join(' · ')
  const status = counts.errors === 0 ? `✓ ${summary}` : summary
  return [...errorsFirst.map(formatViolation), status].join('\n\n') + '\n'
}

export function formatJson(result: CheckResult): JsonReport {
  const counts = summarize(result.violations)
  return { ok: counts.errors === 0, ...counts, routes: result.routes, violations: result.violations }
}
