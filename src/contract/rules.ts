export type Severity = 'error' | 'warning'

export const RULES = {
  'contract-missing': { number: 1, severity: 'error', title: 'auth, input, output and handler are required' },
  'owner-required': { number: 2, severity: 'error', title: 'user routes declare an owner (or unsafe.noOwner)' },
  'load-required': { number: 3, severity: 'error', title: 'routes with a :param load the resource they act on' },
  'owner-not-applicable': { number: 4, severity: 'error', title: 'admin and public routes do not declare an owner' },
  'public-write': { number: 5, severity: 'error', title: 'DELETE/PUT/PATCH are not public (or unsafe.publicWrite)' },
  'sensitive-field': { number: 6, severity: 'error', title: 'no sensitive fields in output (or unsafe.exposeSensitive)' },
  'owner-from-client': { number: 7, severity: 'error', title: 'the body does not carry the owner field (or unsafe.ownerFromClient)' },
  'open-schema': { number: 8, severity: 'error', title: 'input and output schemas are closed and supported' },
  'list-output-array': { number: 9, severity: 'error', title: 'list routes with an owner return an array at the root' },
  'file-name': { number: 10, severity: 'error', title: 'route files follow <segments>.<method>.ts' },
  'auth-rate-limit': { number: 11, severity: 'warning', title: 'login/register/reset routes declare a rateLimit' },
  'owner-in-output': { number: 12, severity: 'error', title: 'create/action routes with an owner return the owner field' },
  'unsafe-invalid': { number: 13, severity: 'error', title: 'unsafe uses known keys with real reasons' },
  'unsafe-used': { number: 14, severity: 'warning', title: 'every use of unsafe is reported' },
  'params-mismatch': { number: 15, severity: 'error', title: 'input.params declares exactly the path params' },
} as const satisfies Record<string, { number: number; severity: Severity; title: string }>

export type RuleId = keyof typeof RULES

export interface Violation {
  rule: number
  id: RuleId
  severity: Severity
  file: string
  message: string
  fix: string
}

export const SENSITIVE_FIELD = /password|hash|secret|token|apikey|api_key|ssn/i

const AUTH_ROUTE_SEGMENTS = new Set(['login', 'register', 'signup'])

export function isAuthRoute(path: string): boolean {
  return path
    .split('/')
    .some((segment) => AUTH_ROUTE_SEGMENTS.has(segment) || segment.startsWith('reset') || segment.startsWith('password-reset'))
}

export const UNSAFE_KEYS = ['noOwner', 'publicWrite', 'exposeSensitive', 'ownerFromClient'] as const
export type UnsafeKey = (typeof UNSAFE_KEYS)[number]

export const MIN_REASON_LENGTH = 15

export const WRITE_METHODS: ReadonlySet<string> = new Set(['put', 'patch', 'delete'])

export function violation(id: RuleId, file: string, message: string, fix: string): Violation {
  const rule = RULES[id]
  return { rule: rule.number, id, severity: rule.severity, file, message, fix }
}
