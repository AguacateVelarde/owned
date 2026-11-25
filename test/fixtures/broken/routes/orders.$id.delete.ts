import { z } from 'zod'

export default {
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  owner: 'userId',
  output: z.object({ ok: z.literal(true) }),
  handler: async () => ({ ok: true as const }),
}
