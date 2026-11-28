import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.array(z.object({ id: z.string(), userId: z.string(), text: z.string() })),
  handler: ({ user }) => getDb().comments.where((comment) => comment.userId === String(user.id)),
})
