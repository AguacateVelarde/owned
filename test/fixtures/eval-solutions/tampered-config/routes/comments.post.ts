import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { body: z.object({ text: z.string().min(1) }) },
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string(), text: z.string() }),
  handler: ({ input, user }) =>
    getDb().comments.insert({ id: crypto.randomUUID(), userId: String(user.id), text: input.body.text }),
})
