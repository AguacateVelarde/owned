import { z } from 'zod'

export default {
  auth: 'admin',
  input: {},
  output: z.array(z.object({ id: z.string() })),
  handler: async () => [],
}
