import { defineRoute, z } from 'owned'

export default defineRoute({
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.object({ id: z.string() }),
  handler: () => ({ id: 1 }),
})
