import { defineConfig } from 'owned'

export default defineConfig({
  authenticate: async () => ({ id: 'admin', role: 'admin' }),
})
