import { z } from 'zod'

export default {
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.array(z.object({ id: z.string(), userId: z.string(), total: z.number() })),
  handler: async () => [],
}
