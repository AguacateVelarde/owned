import { z } from 'zod'

export type Io = 'input' | 'output'

export type JsonSchema = { [key: string]: unknown } | boolean

export const UNSUPPORTED_KEY = 'x-owned-unsupported'

export interface SchemaIssue {
  kind: 'open' | 'unsupported'
  path: string
  zodType?: string
}

const UNREPRESENTABLE_ZOD_TYPES = new Set([
  'bigint',
  'symbol',
  'undefined',
  'void',
  'map',
  'set',
  'transform',
  'nan',
  'custom',
  'function',
  'promise',
])

const CONSTRAINING_KEYS = [
  'type',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
  'const',
  'enum',
  'not',
  'properties',
  'items',
  'prefixItems',
  UNSUPPORTED_KEY,
]

export function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType
}

function publicZodTypeName(schema: unknown): string {
  return (schema as z.ZodType).type
}

function markUnrepresentableNode(zodSchema: unknown, jsonSchema: Record<string, unknown>): void {
  const emittedAsEmptyObject = Object.keys(jsonSchema).length === 0
  if (!emittedAsEmptyObject) return
  const zodType = publicZodTypeName(zodSchema)
  if (zodType === 'date') {
    jsonSchema.type = 'string'
    jsonSchema.format = 'date-time'
  } else if (UNREPRESENTABLE_ZOD_TYPES.has(zodType)) {
    jsonSchema[UNSUPPORTED_KEY] = zodType
  }
}

export function toJsonSchema(schema: z.ZodType, io: Io): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    override: (ctx) => markUnrepresentableNode(ctx.zodSchema, ctx.jsonSchema),
  }) as Record<string, unknown>
  const { $schema: _droppedForPlainComparison, ...rest } = json
  return rest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

type Visitor = (node: Record<string, unknown> | boolean, path: string) => void

function walkWithoutFollowingRefs(node: JsonSchema, path: string, visit: Visitor): void {
  visit(node, path)
  if (!isRecord(node)) return

  if (isRecord(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      walkWithoutFollowingRefs(child as JsonSchema, join(path, key), visit)
    }
  }
  const itemsRejectEverything = node.items === false
  if ((isRecord(node.items) || node.items === true) && !itemsRejectEverything) {
    walkWithoutFollowingRefs(node.items as JsonSchema, `${path}[]`, visit)
  }
  if (Array.isArray(node.prefixItems)) {
    node.prefixItems.forEach((child, i) => walkWithoutFollowingRefs(child as JsonSchema, `${path}[${i}]`, visit))
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = node[key]
    if (Array.isArray(variants)) {
      for (const child of variants) walkWithoutFollowingRefs(child as JsonSchema, path, visit)
    }
  }
  if (isRecord(node.$defs)) {
    for (const [name, child] of Object.entries(node.$defs)) {
      walkWithoutFollowingRefs(child as JsonSchema, `$defs.${name}`, visit)
    }
  }
}

function acceptsAnything(node: Record<string, unknown> | boolean): boolean {
  if (node === true) return true
  if (node === false) return false
  return !CONSTRAINING_KEYS.some((key) => key in node)
}

function allowsUndeclaredKeys(node: Record<string, unknown>): boolean {
  return 'additionalProperties' in node && node.additionalProperties !== false
}

export function findSchemaIssues(schema: JsonSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  walkWithoutFollowingRefs(schema, '', (node, path) => {
    if (acceptsAnything(node)) {
      issues.push({ kind: 'open', path })
      return
    }
    if (typeof node === 'boolean') return
    const unsupported = node[UNSUPPORTED_KEY]
    if (typeof unsupported === 'string') {
      issues.push({ kind: 'unsupported', path, zodType: unsupported })
      return
    }
    if (allowsUndeclaredKeys(node)) issues.push({ kind: 'open', path })
  })
  return issues
}

export function listFieldPaths(schema: JsonSchema): string[] {
  const paths: string[] = []
  walkWithoutFollowingRefs(schema, '', (node, path) => {
    if (!isRecord(node) || !isRecord(node.properties)) return
    for (const key of Object.keys(node.properties)) paths.push(join(path, key))
  })
  return [...new Set(paths)]
}

export function rootType(schema: JsonSchema): string | undefined {
  return isRecord(schema) && typeof schema.type === 'string' ? schema.type : undefined
}

export function rootProperties(schema: JsonSchema): string[] {
  return isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : []
}
