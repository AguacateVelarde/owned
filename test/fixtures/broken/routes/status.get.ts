import { z } from 'zod'

enum Status {
  Open = 'open',
}

export default {
  auth: 'public',
  input: {},
  output: z.object({ status: z.literal(Status.Open) }),
  handler: async () => ({ status: Status.Open }),
}
