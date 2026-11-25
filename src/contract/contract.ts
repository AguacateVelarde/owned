import type { ZodType } from 'zod'
import type { Auth, RouteInput } from '../types.ts'
import { isZodSchema } from './schema.ts'
import { MIN_REASON_LENGTH, UNSAFE_KEYS, violation, type UnsafeKey, type Violation } from './rules.ts'

export interface ParsedUnsafe {
  noOwner: string | undefined
  publicWrite: string | undefined
  ownerFromClient: string | undefined
  exposeSensitive: Record<string, string>
}

export interface Contract {
  auth: Auth
  input: RouteInput
  output: ZodType
  owner: string | undefined
  hasLoad: boolean
  hasRateLimit: boolean
  unsafe: ParsedUnsafe
}

export interface ContractResult {
  contract: Contract | undefined
  violations: Violation[]
}

const AUTH_LEVELS: readonly Auth[] = ['public', 'user', 'admin']
const INPUT_KEYS = ['params', 'query', 'body'] as const

const ROUTE_TEMPLATE = `export default defineRoute({
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string() }),
  handler: async ({ input }) => ({ id: '...', userId: '...' }),
})`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuth(value: unknown): value is Auth {
  return typeof value === 'string' && (AUTH_LEVELS as readonly string[]).includes(value)
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRealReason(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= MIN_REASON_LENGTH
}

function missing(file: string, message: string, fix: string): Violation {
  return violation('contract-missing', file, message, fix)
}

function parseAuth(file: string, value: unknown, problems: Violation[]): Auth | undefined {
  if (isAuth(value)) return value
  problems.push(missing(file, `auth must be one of ${AUTH_LEVELS.join(', ')}; got ${JSON.stringify(value)}`, `auth: 'user',`))
  return undefined
}

function parseInput(file: string, value: unknown, problems: Violation[]): RouteInput | undefined {
  if (!isRecord(value)) {
    problems.push(missing(file, 'input is required; use {} when the route takes no input', 'input: {},'))
    return undefined
  }
  const unknownKeys = Object.keys(value).filter((key) => !(INPUT_KEYS as readonly string[]).includes(key))
  const notSchemas = INPUT_KEYS.filter((key) => value[key] !== undefined && !isZodSchema(value[key]))
  if (unknownKeys.length > 0 || notSchemas.length > 0) {
    const bad = [...unknownKeys.map((k) => `unknown key ${k}`), ...notSchemas.map((k) => `${k} is not a Zod schema`)]
    problems.push(
      missing(
        file,
        `input only takes Zod schemas under params, query and body (${bad.join('; ')})`,
        'input: { params: z.object({ id: z.string() }), query: z.object({}), body: z.object({}) },',
      ),
    )
    return undefined
  }
  const input: RouteInput = {}
  for (const key of INPUT_KEYS) {
    const schema = value[key]
    if (isZodSchema(schema)) input[key] = schema
  }
  return input
}

function parseOutput(file: string, value: unknown, problems: Violation[]): ZodType | undefined {
  if (isZodSchema(value)) return value
  problems.push(
    missing(file, 'output must be a Zod schema describing exactly what the route returns', 'output: z.object({ id: z.string() }),'),
  )
  return undefined
}

function checkHandler(file: string, value: unknown, problems: Violation[]): void {
  if (typeof value === 'function') return
  problems.push(missing(file, 'handler must be a function', 'handler: async ({ input }) => ({ ... }),'))
}

function parseOwner(file: string, value: unknown, problems: Violation[]): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim() !== '') return value
  problems.push(missing(file, 'owner must be the name of the field that holds the owning user id', `owner: 'userId',`))
  return undefined
}

function parseLoad(file: string, value: unknown, problems: Violation[]): boolean {
  if (value === undefined) return false
  if (typeof value === 'function') return true
  problems.push(missing(file, 'load must be a function that fetches the resource by params', 'load: ({ params }) => getDb().orders.find(params.id),'))
  return false
}

function parseRateLimit(file: string, value: unknown, problems: Violation[]): boolean {
  if (value === undefined) return false
  if (isRecord(value) && isPositiveNumber(value.max) && isPositiveNumber(value.windowSec)) return true
  problems.push(missing(file, 'rateLimit must have a positive max and windowSec', 'rateLimit: { max: 5, windowSec: 60 },'))
  return false
}

function invalidUnsafe(file: string, message: string, fix: string): Violation {
  return violation('unsafe-invalid', file, message, fix)
}

function reasonFix(key: string): string {
  return `unsafe: { ${key}: '<a real reason, at least ${MIN_REASON_LENGTH} characters>' },`
}

function parseExposeSensitive(file: string, value: unknown, problems: Violation[]): Record<string, string> {
  if (!isRecord(value)) {
    problems.push(invalidUnsafe(file, 'unsafe.exposeSensitive maps each field path to a reason', `unsafe: { exposeSensitive: { apiKeyLast4: '<why it is safe to expose>' } },`))
    return {}
  }
  const allowed: Record<string, string> = {}
  for (const [field, reason] of Object.entries(value)) {
    if (isRealReason(reason)) {
      allowed[field] = reason
    } else {
      problems.push(invalidUnsafe(file, `unsafe.exposeSensitive.${field} needs a real reason (at least ${MIN_REASON_LENGTH} characters)`, `unsafe: { exposeSensitive: { ${field}: '<why it is safe to expose>' } },`))
    }
  }
  return allowed
}

function parseUnsafe(file: string, value: unknown, problems: Violation[]): ParsedUnsafe {
  const unsafe: ParsedUnsafe = { noOwner: undefined, publicWrite: undefined, ownerFromClient: undefined, exposeSensitive: {} }
  if (value === undefined) return unsafe
  if (!isRecord(value)) {
    problems.push(invalidUnsafe(file, 'unsafe must be an object', `valid keys: ${UNSAFE_KEYS.join(', ')}`))
    return unsafe
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!(UNSAFE_KEYS as readonly string[]).includes(key)) {
      problems.push(invalidUnsafe(file, `unknown unsafe key ${key}`, `valid keys: ${UNSAFE_KEYS.join(', ')}`))
      continue
    }
    const known = key as UnsafeKey
    if (known === 'exposeSensitive') {
      unsafe.exposeSensitive = parseExposeSensitive(file, entry, problems)
    } else if (isRealReason(entry)) {
      unsafe[known] = entry
    } else {
      problems.push(invalidUnsafe(file, `unsafe.${known} needs a real reason (at least ${MIN_REASON_LENGTH} characters)`, reasonFix(known)))
    }
  }
  return unsafe
}

export function parseContract(file: string, def: unknown): ContractResult {
  if (!isRecord(def)) {
    return {
      contract: undefined,
      violations: [missing(file, 'the route module must export default defineRoute({ ... })', ROUTE_TEMPLATE)],
    }
  }
  const shapeProblems: Violation[] = []
  const auth = parseAuth(file, def.auth, shapeProblems)
  const input = parseInput(file, def.input, shapeProblems)
  const output = parseOutput(file, def.output, shapeProblems)
  checkHandler(file, def.handler, shapeProblems)
  const owner = parseOwner(file, def.owner, shapeProblems)
  const hasLoad = parseLoad(file, def.load, shapeProblems)
  const hasRateLimit = parseRateLimit(file, def.rateLimit, shapeProblems)

  const unsafeProblems: Violation[] = []
  const unsafe = parseUnsafe(file, def.unsafe, unsafeProblems)

  const violations = [...shapeProblems, ...unsafeProblems]
  if (shapeProblems.length > 0 || auth === undefined || input === undefined || output === undefined) {
    return { contract: undefined, violations }
  }
  return { contract: { auth, input, output, owner, hasLoad, hasRateLimit, unsafe }, violations }
}
