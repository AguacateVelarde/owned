import { z } from 'zod'

export default {
  auth: 'admin',
  input: { params: z.object({ id: z.string() }) },
  output: z.object({ id: z.string(), email: z.string(), passwordHash: z.string() }),
  handler: async () => ({ id: 'u1', email: 'a@b.c', passwordHash: 'x' }),
}
