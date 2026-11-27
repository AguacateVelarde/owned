import type { RouteShape } from '../types.ts'
import { renderAgentsMd } from './agents-md.ts'

export interface ProjectFile {
  path: string
  content: string
}

export interface RouteTemplate {
  file: string
  shape: RouteShape
  title: string
  content: string
}

const HEALTH_ROUTE: RouteTemplate = {
  file: 'health.get.ts',
  shape: 'list',
  title: 'Public route: anyone can call it, no owner',
  content: `import { defineRoute, z } from 'owned'

export default defineRoute({
  auth: 'public',
  input: {},
  output: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true }),
})
`,
}

export const ROUTE_TEMPLATES: readonly RouteTemplate[] = [
  HEALTH_ROUTE,
  {
    file: 'notes.get.ts',
    shape: 'list',
    title: 'List route: GET without a :param returns only the caller\'s items',
    content: `import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.array(z.object({ id: z.string(), userId: z.string(), text: z.string() })),
  handler: ({ user }) => getDb().notes.where((note) => note.userId === String(user.id)),
})
`,
  },
  {
    file: 'notes.post.ts',
    shape: 'action',
    title: 'Create route: the owner comes from the logged-in user, never from the body',
    content: `import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { body: z.object({ text: z.string().min(1) }) },
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string(), text: z.string() }),
  handler: ({ input, user }) =>
    getDb().notes.insert({ id: crypto.randomUUID(), userId: String(user.id), text: input.body.text }),
})
`,
  },
  {
    file: 'notes.$id.delete.ts',
    shape: 'resource',
    title: 'Resource route: load fetches by params, owned checks the owner before the handler',
    content: `import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { params: z.object({ id: z.string() }) },
  load: ({ params }) => getDb().notes.find(params.id),
  owner: 'userId',
  output: z.object({ ok: z.literal(true) }),
  handler: ({ resource }) => {
    getDb().notes.remove(resource.id)
    return { ok: true }
  },
})
`,
  },
]

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2023',
    module: 'nodenext',
    moduleResolution: 'nodenext',
    types: ['node'],
    strict: true,
    erasableSyntaxOnly: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  },
}

const OWNED_CONFIG = `import { defineConfig } from 'owned'

export default defineConfig({
  authenticate: async (c) => {
    if (process.env.NODE_ENV !== 'test') return null
    const id = c.req.header('x-user-id')
    if (id === undefined) return null
    return { id, role: c.req.header('x-user-role') ?? 'user' }
  },
})
`

const DB = `export interface Note {
  id: string
  userId: string
  text: string
}

function table<Row extends { id: string }>() {
  const rows = new Map<string, Row>()
  return {
    find: (id: string): Row | null => rows.get(id) ?? null,
    where: (match: (row: Row) => boolean): Row[] => [...rows.values()].filter(match),
    insert: (row: Row): Row => {
      rows.set(row.id, row)
      return row
    },
    remove: (id: string): boolean => rows.delete(id),
  }
}

function createDb() {
  return { notes: table<Note>() }
}

let db: ReturnType<typeof createDb> | undefined

export function getDb() {
  db ??= createDb()
  return db
}
`

const CLAUDE_MD = `# CLAUDE.md

Read AGENTS.md before changing anything in this project and follow it exactly.
`

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function packageJson(name: string, ownedVersion: string) {
  return {
    name,
    private: true,
    type: 'module',
    engines: { node: '>=22.18' },
    scripts: { check: 'owned check', test: 'NODE_ENV=test node --test' },
    dependencies: { owned: `^${ownedVersion}` },
    devDependencies: { '@types/node': '^26.0.0', typescript: '^7.0.0' },
  }
}

export function projectFiles(name: string, ownedVersion: string): ProjectFile[] {
  return [
    { path: 'package.json', content: json(packageJson(name, ownedVersion)) },
    { path: 'tsconfig.json', content: json(TSCONFIG) },
    { path: '.gitignore', content: 'node_modules\n' },
    { path: 'owned.config.ts', content: OWNED_CONFIG },
    { path: 'db.ts', content: DB },
    { path: `routes/${HEALTH_ROUTE.file}`, content: HEALTH_ROUTE.content },
    { path: 'AGENTS.md', content: renderAgentsMd(ROUTE_TEMPLATES) },
    { path: 'CLAUDE.md', content: CLAUDE_MD },
  ]
}
