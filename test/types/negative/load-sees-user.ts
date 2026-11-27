import { defineRoute, z } from 'owned'

export default defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: ({ user }) => ({ userId: user.id }),
  owner: 'userId',
  output: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true as const }),
})
