import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }), body: z.object({ text: z.string().min(1) }) },
  load: ({ params }) => getDb().comments.find(params.id),
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string(), text: z.string() }),
  handler: ({ input, resource }) => getDb().comments.insert({ ...resource, text: input.body.text }),
})
