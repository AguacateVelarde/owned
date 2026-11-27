import type { Context } from 'hono'
import type { z, ZodType } from 'zod'
import type { Auth, RateLimit, Unsafe } from './types.ts'

export interface AuthUser {
  id: string | number
  role?: string
}

type Parsed<S> = S extends ZodType ? z.output<S> : undefined

type UserFor<A extends Auth> = A extends 'public' ? AuthUser | undefined : AuthUser

type MaybePromise<T> = T | Promise<T>

export interface HandlerArgs<A extends Auth, P, Q, B, R> {
  input: { params: Parsed<P>; query: Parsed<Q>; body: Parsed<B> }
  resource: R
  user: UserFor<A>
}

export interface RouteConfig<
  O extends ZodType,
  A extends Auth,
  P extends ZodType | undefined,
  Q extends ZodType | undefined,
  B extends ZodType | undefined,
  R,
> {
  auth: A
  input: { params?: P; query?: Q; body?: B }
  output: O
  owner?: string
  load?: (args: { params: Parsed<P> }) => MaybePromise<R>
  rateLimit?: RateLimit
  unsafe?: Unsafe
  handler: (args: HandlerArgs<A, P, Q, B, Awaited<R>>) => MaybePromise<z.input<O>>
}

export function defineRoute<
  O extends ZodType,
  A extends Auth,
  P extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  B extends ZodType | undefined = undefined,
  R = undefined,
>(route: RouteConfig<O, A, P, Q, B, R>): RouteConfig<O, A, P, Q, B, R> {
  return route
}

export interface OwnedConfig {
  authenticate: (c: Context) => MaybePromise<AuthUser | null>
}

export function defineConfig(config: OwnedConfig): OwnedConfig {
  return config
}
