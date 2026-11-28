import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: ({ params }) => getDb().comments.find(params.id),
  owner: 'userId',
  output: z.object({ ok: z.literal(true) }),
  handler: ({ resource }) => {
    getDb().comments.remove(resource.id)
    return { ok: true }
  },
})
