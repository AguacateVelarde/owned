import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'public',
  input: {},
  output: z.array(z.object({ id: z.string(), userId: z.string(), text: z.string() })),
  handler: () => getDb().comments.where(() => true),
})
