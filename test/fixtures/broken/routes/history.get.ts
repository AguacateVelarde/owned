import { z } from 'zod'
import { getDb } from '../db'

export default {
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.array(z.object({ id: z.string(), userId: z.string() })),
  handler: async () => [getDb().orders.find('o1')],
}
