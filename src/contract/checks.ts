import type { RouteShape } from '../types.ts'
import type { Contract } from './contract.ts'
import type { ParsedRouteFile } from './route-file.ts'
import { isAuthRoute, SENSITIVE_FIELD, violation, WRITE_METHODS, type Violation } from './rules.ts'
import { findSchemaIssues, listFieldPaths, rootProperties, rootType, type JsonSchema, type SchemaIssue } from './schema.ts'

export interface RouteSchemas {
  output: JsonSchema
  params: JsonSchema | undefined
  query: JsonSchema | undefined
  body: JsonSchema | undefined
}

export interface RuleContext {
  file: string
  route: ParsedRouteFile | undefined
  shape: RouteShape | undefined
  contract: Contract
  schemas: RouteSchemas
}

export type Check = (ctx: RuleContext) => Violation[]

function isUserRoute(ctx: RuleContext): boolean {
  return ctx.contract.auth === 'user'
}

function resourceName(route: ParsedRouteFile): string {
  return route.path.split('/').filter((s) => s !== '' && !s.startsWith(':')).at(-1) ?? 'items'
}

export const checkParamsMatchPath: Check = ({ file, route, schemas }) => {
  if (route === undefined) return []
  const declared = schemas.params === undefined ? [] : rootProperties(schemas.params)
  if (route.params.length === 0) {
    return schemas.params === undefined
      ? []
      : [violation('params-mismatch', file, `${route.path} has no path params but input.params is declared`, 'remove input.params: this route has no path params')]
  }
  const same = declared.length === route.params.length && route.params.every((p) => declared.includes(p))
  if (same) return []
  const fields = route.params.map((p) => `${p}: z.string()`).join(', ')
  return [
    violation(
      'params-mismatch',
      file,
      `input.params must declare exactly the path params of ${route.path} (${route.params.join(', ')}); got ${declared.join(', ') || 'none'}`,
      `input: { params: z.object({ ${fields} }) },`,
    ),
  ]
}

export const checkOwnerDeclared: Check = (ctx) => {
  const { file, contract } = ctx
  if (!isUserRoute(ctx)) {
    return contract.owner === undefined
      ? []
      : [violation('owner-not-applicable', file, `${contract.auth} routes do not compare owners; owner has no effect here`, `remove owner: '${contract.owner}'`)]
  }
  if (contract.owner !== undefined && contract.unsafe.noOwner !== undefined) {
    return [violation('owner-required', file, 'declare owner or unsafe.noOwner, not both', `remove unsafe.noOwner, or remove owner: '${contract.owner}'`)]
  }
  if (contract.owner === undefined && contract.unsafe.noOwner === undefined) {
    return [
      violation(
        'owner-required',
        file,
        'user routes must say which field holds the owning user id, or nothing stops one user from reading another user\'s data',
        `owner: 'userId',\n\nor, only if this route never returns another user's data:\nunsafe: { noOwner: '<why this route has no owner>' },`,
      ),
    ]
  }
  return []
}

export const checkLoadPlacement: Check = (ctx) => {
  const { file, route, shape, contract } = ctx
  if (route === undefined || shape === undefined) return []
  if (shape !== 'resource' && contract.hasLoad) {
    return [violation('load-required', file, 'load only runs on routes with a :param; this route has none', 'remove load')]
  }
  const needsLoad = isUserRoute(ctx) && shape === 'resource' && contract.owner !== undefined && !contract.hasLoad
  if (!needsLoad) return []
  const lastParam = route.params[route.params.length - 1]
  return [
    violation(
      'load-required',
      file,
      `${route.path} acts on one resource; load it so owned can check that it belongs to the user`,
      `load: ({ params }) => getDb().${resourceName(route)}.find(params.${lastParam}),`,
    ),
  ]
}

export const checkPublicWrite: Check = ({ file, route, contract }) => {
  if (route === undefined || contract.auth !== 'public' || !WRITE_METHODS.has(route.method)) return []
  if (contract.unsafe.publicWrite !== undefined) return []
  return [
    violation(
      'public-write',
      file,
      `${route.method.toUpperCase()} ${route.path} lets anyone change or delete data`,
      `auth: 'user',\n\nor, only if anonymous writes are intended:\nunsafe: { publicWrite: '<why anonymous writes are safe here>' },`,
    ),
  ]
}

function leafName(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).replace(/\[\d*\]$/, '')
}

export const checkSensitiveFields: Check = ({ file, contract, schemas }) =>
  listFieldPaths(schemas.output)
    .filter((path) => SENSITIVE_FIELD.test(leafName(path)) && contract.unsafe.exposeSensitive[path] === undefined)
    .map((path) =>
      violation(
        'sensitive-field',
        file,
        `output exposes ${path}, which looks like a secret`,
        `remove ${path} from output, or:\nunsafe: { exposeSensitive: { '${path}': '<why it is safe to expose>' } },`,
      ),
    )

export const checkOwnerFromClient: Check = ({ file, contract, schemas }) => {
  const owner = contract.owner
  if (owner === undefined || schemas.body === undefined) return []
  if (!rootProperties(schemas.body).includes(owner) || contract.unsafe.ownerFromClient !== undefined) return []
  return [
    violation(
      'owner-from-client',
      file,
      `input.body accepts ${owner}, so a client can create data owned by someone else`,
      `remove ${owner} from input.body and set it from ctx.user.id in the handler`,
    ),
  ]
}

function schemaIssueFix(issue: SchemaIssue): string {
  if (issue.kind === 'open') {
    return 'declare every field with z.object({ ... }) instead of looseObject, passthrough, catchall, record, any or unknown'
  }
  if (issue.zodType === 'transform') {
    return 'add .pipe(<output schema>) after the transform, e.g. z.string().transform((s) => s.length).pipe(z.number())'
  }
  return `replace ${issue.zodType} with a JSON type such as z.string() or z.number()`
}

function schemaIssueMessage(where: string, issue: SchemaIssue): string {
  const at = issue.path === '' ? where : `${where}.${issue.path}`
  return issue.kind === 'open'
    ? `${at} accepts undeclared data`
    : `${at} uses ${issue.zodType}, which owned cannot inspect`
}

export const checkClosedSchemas: Check = ({ file, schemas }) => {
  const targets: Array<[string, JsonSchema | undefined]> = [
    ['output', schemas.output],
    ['input.params', schemas.params],
    ['input.query', schemas.query],
    ['input.body', schemas.body],
  ]
  return targets.flatMap(([where, schema]) =>
    schema === undefined
      ? []
      : findSchemaIssues(schema).map((issue) =>
          violation('open-schema', file, schemaIssueMessage(where, issue), schemaIssueFix(issue)),
        ),
  )
}

export const checkListReturnsArray: Check = (ctx) => {
  const { file, shape, contract, schemas } = ctx
  if (!isUserRoute(ctx) || shape !== 'list' || contract.owner === undefined) return []
  if (rootType(schemas.output) === 'array') return []
  return [
    violation(
      'list-output-array',
      file,
      'owned filters list results by owner, so the output must be an array at the root',
      'output: z.array(z.object({ ... })),',
    ),
  ]
}

export const checkOwnerInOutput: Check = (ctx) => {
  const { file, shape, contract, schemas } = ctx
  const owner = contract.owner
  if (!isUserRoute(ctx) || shape !== 'action' || owner === undefined) return []
  if (rootProperties(schemas.output).includes(owner)) return []
  return [
    violation(
      'owner-in-output',
      file,
      `owned verifies that the created resource belongs to the user, so output must include ${owner}`,
      `output: z.object({ ..., ${owner}: z.string() }),`,
    ),
  ]
}

export const checkAuthRateLimit: Check = ({ file, route, contract }) => {
  if (route === undefined || !isAuthRoute(route.path) || contract.hasRateLimit) return []
  return [
    violation(
      'auth-rate-limit',
      file,
      `${route.path} is an authentication route without rateLimit, so it is open to brute force`,
      'rateLimit: { max: 5, windowSec: 60 },',
    ),
  ]
}

export const reportUnsafeUse: Check = ({ file, contract }) => {
  const { exposeSensitive, ...reasons } = contract.unsafe
  const keyed = Object.entries(reasons)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, reason]) => [`unsafe.${key}`, reason] as const)
  const fields = Object.entries(exposeSensitive).map(([field, reason]) => [`unsafe.exposeSensitive.${field}`, reason] as const)
  return [...keyed, ...fields].map(([where, reason]) =>
    violation('unsafe-used', file, `${where}: "${reason}"`, 'remove it unless the human asked for this exception'),
  )
}

export const CHECKS: readonly Check[] = [
  checkParamsMatchPath,
  checkOwnerDeclared,
  checkLoadPlacement,
  checkPublicWrite,
  checkSensitiveFields,
  checkOwnerFromClient,
  checkClosedSchemas,
  checkListReturnsArray,
  checkOwnerInOutput,
  checkAuthRateLimit,
  reportUnsafeUse,
]
