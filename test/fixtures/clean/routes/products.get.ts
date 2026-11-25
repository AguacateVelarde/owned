import { z } from 'zod'

if (process.env.OWNED_CHECK !== '1') {
  throw new Error('connected to the database at import time')
}

export default {
  auth: 'public',
  input: {},
  output: z.array(z.object({ id: z.string(), name: z.string() })),
  handler: async () => [],
}
