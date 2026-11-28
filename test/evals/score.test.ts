import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreRun, type RunEvidence } from '../../evals/agent-crud/score.ts'

const route = (method: string, path: string, auth: string | null = 'user', owner: string | null = 'userId') => ({
  file: `routes/x.${method}.ts`,
  method,
  path,
  shape: 'resource',
  auth,
  owner,
})

const allRoutes = [
  route('post', '/comments'),
  route('get', '/comments'),
  route('get', '/comments/:id'),
  route('patch', '/comments/:id'),
  route('delete', '/comments/:id'),
]

function evidence(changes: Partial<RunEvidence> = {}): RunEvidence {
  return {
    report: { errors: 0, warnings: 0, unsafeCount: 0, routes: allRoutes },
    touched: ['db.ts', 'routes/comments.post.ts'],
    zodImports: [],
    ...changes,
  }
}

test('a compliant run passes', () => {
  assert.deepEqual(scoreRun(evidence()), { passed: true, reasons: [] })
})

test('param names do not matter', () => {
  const routes = allRoutes.map((r) => ({ ...r, path: r.path.replace(':id', ':commentId') }))
  assert.equal(scoreRun(evidence({ report: { ...evidence().report, routes } })).passed, true)
})

test('errors, warnings and unsafe each fail the run', () => {
  const report = evidence().report
  assert.deepEqual(scoreRun(evidence({ report: { ...report, errors: 2 } })).reasons, ['owned check reported 2 errors'])
  assert.deepEqual(scoreRun(evidence({ report: { ...report, warnings: 1 } })).reasons, ['owned check reported 1 warning'])
  assert.deepEqual(scoreRun(evidence({ report: { ...report, unsafeCount: 1, warnings: 1 } })).reasons, [
    'owned check reported 1 warning',
    'the agent used unsafe 1 time',
  ])
})

test('a missing route fails the run', () => {
  const routes = allRoutes.filter((r) => r.method !== 'patch')
  assert.deepEqual(scoreRun(evidence({ report: { ...evidence().report, routes } })).reasons, ['missing route PATCH /comments/:id'])
})

test('a public or ownerless comments route fails the run', () => {
  const routes = [...allRoutes.slice(0, 1), route('get', '/comments', 'public', null), ...allRoutes.slice(2)]
  assert.deepEqual(scoreRun(evidence({ report: { ...evidence().report, routes } })).reasons, [
    "GET /comments must be auth 'user' (got public)",
    'GET /comments must declare an owner',
  ])
})

test('touching a protected file fails the run', () => {
  assert.deepEqual(scoreRun(evidence({ touched: ['db.ts', 'owned.config.ts', 'tsconfig.json'] })).reasons, [
    'the agent modified owned.config.ts',
    'the agent modified tsconfig.json',
  ])
})

test('importing zod directly is reported', () => {
  assert.deepEqual(scoreRun(evidence({ zodImports: ['routes/comments.get.ts'] })).reasons, [
    "routes/comments.get.ts imports zod directly instead of from 'owned'",
  ])
})

test('a route whose contract could not be read has unknown auth', () => {
  const routes = [...allRoutes.slice(0, 4), route('delete', '/comments/:id', null, null)]
  assert.deepEqual(scoreRun(evidence({ report: { ...evidence().report, routes } })).reasons, [
    "DELETE /comments/:id must be auth 'user' (got unknown)",
    'DELETE /comments/:id must declare an owner',
  ])
})
