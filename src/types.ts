import type { ZodType } from 'zod'

export type Auth = 'public' | 'user' | 'admin'
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type RouteShape = 'resource' | 'list' | 'action'

export interface RouteInput {
  params?: ZodType
  query?: ZodType
  body?: ZodType
}

export interface Unsafe {
  noOwner?: string
  publicWrite?: string
  exposeSensitive?: Record<string, string>
  ownerFromClient?: string
}

export interface RateLimit {
  max: number
  windowSec: number
}

export interface RouteDefinition {
  auth: Auth
  input: RouteInput
  output: ZodType
  owner?: string
  load?: (args: { params: unknown }) => unknown
  rateLimit?: RateLimit
  unsafe?: Unsafe
  handler: (...args: never[]) => unknown
}
