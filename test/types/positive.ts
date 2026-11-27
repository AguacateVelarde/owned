import { defineConfig, defineRoute, z, type AuthUser } from 'owned'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function expectType<T extends true>(_proof: T): void {}

const order = z.object({ id: z.string(), userId: z.string(), total: z.number() })

export const resourceRoute = defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }), body: z.object({ total: z.number() }) },
  load: ({ params }) => {
    expectType<Equal<typeof params, { id: string }>>(true)
    return { id: params.id, userId: 'u1', total: 1 }
  },
  owner: 'userId',
  output: order,
  handler: ({ input, resource, user }) => {
    expectType<Equal<typeof input.params, { id: string }>>(true)
    expectType<Equal<typeof input.body, { total: number }>>(true)
    expectType<Equal<typeof input.query, undefined>>(true)
    expectType<Equal<typeof resource, { id: string; userId: string; total: number }>>(true)
    expectType<Equal<typeof user, AuthUser>>(true)
    return resource
  },
})

export const asyncLoadRoute = defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: async ({ params }) => ({ id: params.id, userId: 'u1' }),
  owner: 'userId',
  output: z.object({ ok: z.literal(true) }),
  handler: ({ resource }) => {
    expectType<Equal<typeof resource, { id: string; userId: string }>>(true)
    return { ok: true as const }
  },
})

export const publicRoute = defineRoute({
  auth: 'public',
  input: {},
  output: z.array(z.object({ id: z.string() })),
  handler: ({ input, resource, user }) => {
    expectType<Equal<typeof input.params, undefined>>(true)
    expectType<Equal<typeof resource, undefined>>(true)
    expectType<Equal<typeof user, AuthUser | undefined>>(true)
    return [{ id: 'p1' }]
  },
})

export const adminRoute = defineRoute({
  auth: 'admin',
  input: {},
  output: z.object({ ok: z.boolean() }),
  handler: async ({ user }) => {
    expectType<Equal<typeof user, AuthUser>>(true)
    return { ok: true }
  },
})

export const config = defineConfig({
  authenticate: async (c) => {
    const id = c.req.header('x-user-id')
    return id === undefined ? null : { id, role: c.req.header('x-user-role') ?? 'user' }
  },
})

interface Note {
  id: string
  userId: string
}
const notes = new Map<string, Note>()

export const nullableLoadRoute = defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: ({ params }): Note | null => notes.get(params.id) ?? null,
  owner: 'userId',
  output: z.object({ id: z.string() }),
  handler: ({ resource }) => {
    expectType<Equal<typeof resource, Note>>(true)
    return { id: resource.id }
  },
})

export const optionalLoadRoute = defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: async ({ params }) => notes.get(params.id),
  owner: 'userId',
  output: z.object({ id: z.string() }),
  handler: ({ resource }) => {
    expectType<Equal<typeof resource, Note>>(true)
    return { id: resource.id }
  },
})
