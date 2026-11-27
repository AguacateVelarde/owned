import { defineRoute, z } from 'owned'

export default defineRoute({
  auth: 'everyone',
  input: {},
  output: z.object({}),
  handler: () => ({}),
})
