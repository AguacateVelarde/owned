import { z } from 'zod'

export default {
  auth: 'user',
  input: { body: z.object({ total: z.number(), userId: z.string() }) },
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string(), total: z.number() }),
  handler: async () => ({ id: 'o1', userId: 'u1', total: 1 }),
}
