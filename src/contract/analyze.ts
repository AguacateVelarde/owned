import type { Auth, RouteShape } from '../types.ts'
import { CHECKS, type RouteSchemas, type RuleContext } from './checks.ts'
import { parseContract, type Contract } from './contract.ts'
import { parseRouteFile, VALID_PATTERNS, type ParsedRouteFile } from './route-file.ts'
import { violation, type Violation } from './rules.ts'
import { toJsonSchema } from './schema.ts'

export interface RouteAnalysis {
  file: string
  route: ParsedRouteFile | undefined
  shape: RouteShape | undefined
  auth: Auth | undefined
  owner: string | undefined
  violations: Violation[]
  unsafeCount: number
}

export function classifyShape(route: ParsedRouteFile): RouteShape {
  if (route.params.length > 0) return 'resource'
  return route.method === 'get' ? 'list' : 'action'
}

function inputSchema(contract: Contract, key: 'params' | 'query' | 'body') {
  const schema = contract.input[key]
  return schema === undefined ? undefined : toJsonSchema(schema, 'input')
}

function jsonSchemasOf(contract: Contract): RouteSchemas {
  return {
    output: toJsonSchema(contract.output, 'output'),
    params: inputSchema(contract, 'params'),
    query: inputSchema(contract, 'query'),
    body: inputSchema(contract, 'body'),
  }
}

function runChecks(ctx: Omit<RuleContext, 'schemas'>): Violation[] {
  const withSchemas: RuleContext = { ...ctx, schemas: jsonSchemasOf(ctx.contract) }
  return CHECKS.flatMap((check) => check(withSchemas))
}

export interface RouteFileAnalysis {
  route: ParsedRouteFile | undefined
  shape: RouteShape | undefined
  violations: Violation[]
}

export function analyzeRouteFile(file: string): RouteFileAnalysis {
  const parsedFile = parseRouteFile(file)
  if (!parsedFile.ok) {
    return {
      route: undefined,
      shape: undefined,
      violations: [violation('file-name', file, `invalid route file name: ${parsedFile.reason}`, VALID_PATTERNS.join('\n'))],
    }
  }
  return { route: parsedFile.route, shape: classifyShape(parsedFile.route), violations: [] }
}

export function analyzeRoute(file: string, def: unknown): RouteAnalysis {
  const { route, shape, violations: fileViolations } = analyzeRouteFile(file)
  const { contract, violations: contractViolations } = parseContract(file, def)
  const ruleViolations = contract === undefined ? [] : runChecks({ file, route, shape, contract })

  const violations = [...fileViolations, ...contractViolations, ...ruleViolations]
  return {
    file,
    route,
    shape,
    auth: contract?.auth,
    owner: contract?.owner,
    violations,
    unsafeCount: violations.filter((v) => v.id === 'unsafe-used').length,
  }
}
