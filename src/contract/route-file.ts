import type { Method } from '../types.ts'

export const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete']

export const VALID_PATTERNS = [
  '<segments>.<method>.ts  e.g. products.get.ts -> GET /products',
  '$<param> for a path param  e.g. orders.$id.delete.ts -> DELETE /orders/:id',
  'index.<method>.ts for the root  e.g. index.get.ts -> GET /',
  `<method> is one of: ${METHODS.join(', ')}`,
]

export interface ParsedRouteFile {
  method: Method
  path: string
  params: string[]
  staticSegments: number
}

export type RouteFileResult =
  | { ok: true; route: ParsedRouteFile }
  | { ok: false; reason: string }

const STATIC_SEGMENT = /^[a-z0-9][a-z0-9-]*$/
const PARAM_SEGMENT = /^\$[a-zA-Z][a-zA-Z0-9]*$/

function isMethod(value: string): value is Method {
  return (METHODS as readonly string[]).includes(value)
}

export function parseRouteFile(file: string): RouteFileResult {
  if (file.includes('/') || file.includes('\\')) {
    return { ok: false, reason: 'subdirectories are not supported in v1; use dots: users.$id.get.ts' }
  }
  if (!file.endsWith('.ts')) {
    return { ok: false, reason: 'route files must end in .ts' }
  }
  const parts = file.slice(0, -'.ts'.length).split('.')
  const method = parts.pop()
  if (method === undefined || !isMethod(method)) {
    return { ok: false, reason: `the last part before .ts must be an HTTP method (${METHODS.join(', ')})` }
  }
  if (parts.length === 0 || parts.some((p) => p === '')) {
    return { ok: false, reason: 'missing path segments before the method' }
  }

  if (parts.length === 1 && parts[0] === 'index') {
    return { ok: true, route: { method, path: '/', params: [], staticSegments: 0 } }
  }

  const params: string[] = []
  let staticSegments = 0
  const pathParts: string[] = []
  for (const segment of parts) {
    if (segment === 'index') {
      return { ok: false, reason: '`index` is only valid as the whole route: index.get.ts' }
    }
    if (PARAM_SEGMENT.test(segment)) {
      const name = segment.slice(1)
      if (params.includes(name)) {
        return { ok: false, reason: `duplicate path param: ${segment}` }
      }
      params.push(name)
      pathParts.push(`:${name}`)
    } else if (STATIC_SEGMENT.test(segment)) {
      staticSegments++
      pathParts.push(segment)
    } else {
      return {
        ok: false,
        reason: `invalid segment "${segment}": use lowercase letters, digits and dashes, or $param`,
      }
    }
  }
  return { ok: true, route: { method, path: `/${pathParts.join('/')}`, params, staticSegments } }
}
