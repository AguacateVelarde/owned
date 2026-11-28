import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { analyzeRoute } from '../src/contract/analyze.ts'
import type { RuleId } from '../src/contract/rules.ts'

const handler = () => ({})
const idParams = z.object({ id: z.string() })
const order = z.object({ id: z.string(), userId: z.string(), total: z.number() })

const validRoutes: Record<string, Record<string, unknown>> = {
  'orders.$id.delete.ts': {
    auth: 'user',
    input: { params: idParams },
    load: ({ params }: { params: { id: string } }) => ({ id: params.id }),
    owner: 'userId',
    output: z.object({ ok: z.literal(true) }),
    handler,
  },
  'orders.get.ts': {
    auth: 'user',
    input: {},
    owner: 'userId',
    output: z.array(order),
    handler,
  },
  'orders.post.ts': {
    auth: 'user',
    input: { body: z.object({ total: z.number() }) },
    owner: 'userId',
    output: order,
    handler,
  },
  'products.get.ts': {
    auth: 'public',
    input: { query: z.object({ q: z.string().optional() }) },
    output: z.array(z.object({ id: z.string(), name: z.string() })),
    handler,
  },
  'users.$id.delete.ts': {
    auth: 'admin',
    input: { params: idParams },
    output: z.object({ ok: z.literal(true) }),
    handler,
  },
  'users.$userId.orders.get.ts': {
    auth: 'user',
    input: { params: z.object({ userId: z.string() }) },
    load: ({ params }: { params: { userId: string } }) => ({ id: params.userId }),
    owner: 'id',
    output: z.array(order),
    handler,
  },
}

function routeWith(file: string, changes: Record<string, unknown>): Record<string, unknown> {
  const base = validRoutes[file]
  assert.ok(base, `no valid route for ${file}`)
  const next: Record<string, unknown> = { ...base, ...changes }
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete next[key]
  }
  return next
}

function ids(file: string, def: unknown): RuleId[] {
  return analyzeRoute(file, def).violations.map((v) => v.id)
}

describe('valid contracts', () => {
  for (const [file, def] of Object.entries(validRoutes)) {
    test(`${file} has no violations`, () => {
      assert.deepEqual(analyzeRoute(file, def).violations, [])
    })
  }
})

describe('the analysis reports the declared auth and owner', () => {
  test('a user route with an owner', () => {
    const result = analyzeRoute('orders.get.ts', validRoutes['orders.get.ts'])
    assert.equal(result.auth, 'user')
    assert.equal(result.owner, 'userId')
  })

  test('a public route has no owner', () => {
    const result = analyzeRoute('products.get.ts', validRoutes['products.get.ts'])
    assert.equal(result.auth, 'public')
    assert.equal(result.owner, undefined)
  })

  test('nothing is reported when the contract cannot be parsed', () => {
    const result = analyzeRoute('orders.get.ts', undefined)
    assert.equal(result.auth, undefined)
    assert.equal(result.owner, undefined)
  })
})

describe('route shape is decided by method and path', () => {
  const cases: Array<[string, string]> = [
    ['orders.$id.delete.ts', 'resource'],
    ['users.$userId.orders.get.ts', 'resource'],
    ['orders.get.ts', 'list'],
    ['orders.post.ts', 'action'],
    ['products.get.ts', 'list'],
  ]
  for (const [file, shape] of cases) {
    test(`${file} is ${shape}`, () => {
      assert.equal(analyzeRoute(file, validRoutes[file]).shape, shape)
    })
  }

  test('a list route stays a list even if its output is wrapped in an object', () => {
    const result = analyzeRoute('orders.get.ts', routeWith('orders.get.ts', { output: z.object({ items: z.array(order) }) }))
    assert.equal(result.shape, 'list')
    assert.deepEqual(result.violations.map((v) => v.id), ['list-output-array'])
  })
})

describe('rule 1: contract-missing', () => {
  test('a non-object export is rejected', () => {
    assert.deepEqual(ids('orders.get.ts', undefined), ['contract-missing'])
    assert.deepEqual(ids('orders.get.ts', 'nope'), ['contract-missing'])
  })

  const broken: Array<[string, Record<string, unknown>]> = [
    ['missing auth', { auth: undefined }],
    ['unknown auth', { auth: 'everyone' }],
    ['missing input', { input: undefined }],
    ['input with an unknown key', { input: { headers: z.object({}) } }],
    ['input.body that is not a Zod schema', { input: { body: { total: 'number' } } }],
    ['missing output', { output: undefined }],
    ['output that is not a Zod schema', { output: { type: 'array' } }],
    ['missing handler', { handler: undefined }],
    ['owner that is not a string', { owner: true }],
    ['empty owner', { owner: '' }],
  ]
  for (const [name, changes] of broken) {
    test(name, () => {
      assert.ok(ids('orders.get.ts', routeWith('orders.get.ts', changes)).includes('contract-missing'))
    })
  }

  test('a rateLimit without a positive max and windowSec', () => {
    for (const rateLimit of [{ max: 0, windowSec: 60 }, { max: 5 }, 'fast']) {
      assert.ok(ids('orders.get.ts', routeWith('orders.get.ts', { rateLimit })).includes('contract-missing'))
    }
  })

  test('load that is not a function', () => {
    assert.ok(ids('orders.$id.delete.ts', routeWith('orders.$id.delete.ts', { load: 'db.find' })).includes('contract-missing'))
  })
})

describe('rule 2: owner-required', () => {
  test('a user list without an owner', () => {
    assert.deepEqual(ids('orders.get.ts', routeWith('orders.get.ts', { owner: undefined })), ['owner-required'])
  })

  test('a user route cannot declare both owner and unsafe.noOwner', () => {
    const def = routeWith('orders.get.ts', { unsafe: { noOwner: 'returns only the current user' } })
    assert.ok(ids('orders.get.ts', def).includes('owner-required'))
  })

  test('unsafe.noOwner replaces the owner', () => {
    const def = routeWith('orders.get.ts', { owner: undefined, unsafe: { noOwner: 'returns only the current user' } })
    assert.deepEqual(ids('orders.get.ts', def), ['unsafe-used'])
  })
})

describe('rule 3: load-required', () => {
  test('a user resource route with an owner but no load', () => {
    assert.deepEqual(ids('orders.$id.delete.ts', routeWith('orders.$id.delete.ts', { load: undefined })), ['load-required'])
  })

  test('the fix names the resource and the param from the path', () => {
    const result = analyzeRoute('orders.$orderId.delete.ts', {
      ...routeWith('orders.$id.delete.ts', { load: undefined }),
      input: { params: z.object({ orderId: z.string() }) },
    })
    assert.match(result.violations[0]?.fix ?? '', /getDb\(\)\.orders\.find\(params\.orderId\)/)
  })

  test('a root param route gets a generic resource name in the fix', () => {
    const result = analyzeRoute('$id.delete.ts', routeWith('orders.$id.delete.ts', { load: undefined }))
    assert.match(result.violations[0]?.fix ?? '', /getDb\(\)\.items\.find\(params\.id\)/)
  })

  test('load on a route without path params', () => {
    const def = routeWith('orders.get.ts', { load: () => ({}) })
    assert.deepEqual(ids('orders.get.ts', def), ['load-required'])
  })
})

describe('rule 4: owner-not-applicable', () => {
  test('an admin route with an owner', () => {
    assert.deepEqual(ids('users.$id.delete.ts', routeWith('users.$id.delete.ts', { owner: 'id' })), ['owner-not-applicable'])
  })

  test('a public route with an owner', () => {
    assert.deepEqual(ids('products.get.ts', routeWith('products.get.ts', { owner: 'userId' })), ['owner-not-applicable'])
  })
})

describe('rule 5: public-write', () => {
  const publicDelete = {
    auth: 'public',
    input: { params: idParams },
    output: z.object({ ok: z.literal(true) }),
    handler,
  }

  test('a public DELETE', () => {
    assert.deepEqual(ids('products.$id.delete.ts', publicDelete), ['public-write'])
  })

  test('unsafe.publicWrite allows it with a warning', () => {
    const def = { ...publicDelete, unsafe: { publicWrite: 'demo endpoint wiped nightly' } }
    assert.deepEqual(ids('products.$id.delete.ts', def), ['unsafe-used'])
  })

  test('a public POST is not a write under this rule', () => {
    assert.deepEqual(ids('contact.post.ts', { ...publicDelete, input: {} }), [])
  })
})

describe('rule 6: sensitive-field', () => {
  test('a sensitive field at the root of the output', () => {
    const output = z.object({ id: z.string(), passwordHash: z.string() })
    const result = analyzeRoute('users.$id.delete.ts', routeWith('users.$id.delete.ts', { output }))
    assert.deepEqual(result.violations.map((v) => v.id), ['sensitive-field'])
    assert.match(result.violations[0]?.message ?? '', /passwordHash/)
  })

  test('a nested sensitive field is reported by path', () => {
    const output = z.array(z.object({ id: z.string(), userId: z.string(), owner: z.object({ apiKey: z.string() }) }))
    const result = analyzeRoute('orders.get.ts', routeWith('orders.get.ts', { output }))
    assert.deepEqual(result.violations.map((v) => v.id), ['sensitive-field'])
    assert.match(result.violations[0]?.message ?? '', /\[\]\.owner\.apiKey/)
  })

  test('unsafe.exposeSensitive allows a field by path with a warning', () => {
    const output = z.object({ id: z.string(), apiKeyLast4: z.string() })
    const def = routeWith('users.$id.delete.ts', {
      output,
      unsafe: { exposeSensitive: { apiKeyLast4: 'users see the last 4 digits of their key' } },
    })
    assert.deepEqual(ids('users.$id.delete.ts', def), ['unsafe-used'])
  })
})

describe('rule 7: owner-from-client', () => {
  test('a body that carries the owner field', () => {
    const def = routeWith('orders.post.ts', { input: { body: z.object({ total: z.number(), userId: z.string() }) } })
    assert.deepEqual(ids('orders.post.ts', def), ['owner-from-client'])
  })

  test('unsafe.ownerFromClient allows it with a warning', () => {
    const def = routeWith('orders.post.ts', {
      input: { body: z.object({ total: z.number(), userId: z.string() }) },
      unsafe: { ownerFromClient: 'support staff create orders for users' },
    })
    assert.deepEqual(ids('orders.post.ts', def), ['unsafe-used'])
  })
})

describe('rule 8: open-schema', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['an open output', 'orders.post.ts', { output: z.looseObject({ id: z.string(), userId: z.string() }) }],
    ['an open body', 'orders.post.ts', { input: { body: z.record(z.string(), z.string()) } }],
    ['an open query', 'products.get.ts', { input: { query: z.any() } }],
    ['an open params', 'orders.$id.delete.ts', { input: { params: z.looseObject({ id: z.string() }) } }],
  ]
  for (const [name, file, changes] of cases) {
    test(name, () => {
      assert.deepEqual(ids(file, routeWith(file, changes)), ['open-schema'])
    })
  }

  test('an unsupported type names the type', () => {
    const output = z.object({ id: z.string(), userId: z.string(), total: z.bigint() })
    const result = analyzeRoute('orders.post.ts', routeWith('orders.post.ts', { output }))
    assert.deepEqual(result.violations.map((v) => v.id), ['open-schema'])
    assert.match(result.violations[0]?.message ?? '', /bigint/)
  })

  test('a bare transform in the output suggests .pipe()', () => {
    const output = z.object({ id: z.string(), userId: z.string(), len: z.string().transform((s) => s.length) })
    const result = analyzeRoute('orders.post.ts', routeWith('orders.post.ts', { output }))
    assert.match(result.violations[0]?.fix ?? '', /\.pipe\(/)
  })
})

describe('rule 9: list-output-array', () => {
  test('a user list with an owner and an object output', () => {
    assert.deepEqual(ids('orders.get.ts', routeWith('orders.get.ts', { output: order })), ['list-output-array'])
  })

  test('a nullable array is not an array at the root', () => {
    const def = routeWith('orders.get.ts', { output: z.array(order).nullable() })
    assert.deepEqual(ids('orders.get.ts', def), ['list-output-array'])
  })
})

describe('rule 10: file-name', () => {
  test('an invalid file name is reported with the valid patterns', () => {
    const result = analyzeRoute('orders/$id.get.ts', validRoutes['orders.get.ts'])
    assert.deepEqual(result.violations.map((v) => v.id), ['file-name'])
    assert.match(result.violations[0]?.fix ?? '', /<segments>\.<method>\.ts/)
    assert.equal(result.route, undefined)
    assert.equal(result.shape, undefined)
  })

  test('contract problems are still reported when the file name is invalid', () => {
    const result = analyzeRoute('Orders.get.ts', routeWith('orders.get.ts', { output: z.any() }))
    assert.deepEqual(result.violations.map((v) => v.id).sort(), ['file-name', 'open-schema'])
  })
})

describe('rule 11: auth-rate-limit', () => {
  const login = {
    auth: 'public',
    input: { body: z.object({ email: z.string(), pass: z.string() }) },
    output: z.object({ ok: z.boolean() }),
    handler,
  }

  test('a login route without rateLimit warns', () => {
    const result = analyzeRoute('login.post.ts', login)
    assert.deepEqual(result.violations.map((v) => [v.id, v.severity]), [['auth-rate-limit', 'warning']])
  })

  test('a login route with rateLimit is fine', () => {
    assert.deepEqual(ids('login.post.ts', { ...login, rateLimit: { max: 5, windowSec: 60 } }), [])
  })

  test('reset routes count as auth routes', () => {
    assert.deepEqual(ids('reset-password.post.ts', login), ['auth-rate-limit'])
  })
})

describe('rule 12: owner-in-output', () => {
  test('a create route whose output does not return the owner field', () => {
    const def = routeWith('orders.post.ts', { output: z.object({ id: z.string() }) })
    assert.deepEqual(ids('orders.post.ts', def), ['owner-in-output'])
  })
})

describe('rule 13: unsafe-invalid', () => {
  const file = 'orders.get.ts'
  const noOwner = (unsafe: unknown) => routeWith(file, { owner: undefined, unsafe })

  test('an unknown unsafe key lists the valid keys', () => {
    const result = analyzeRoute(file, routeWith(file, { unsafe: { skipAuth: 'trust me, this is fine' } }))
    const invalid = result.violations.find((v) => v.id === 'unsafe-invalid')
    assert.ok(invalid)
    assert.match(invalid.fix ?? '', /noOwner.*publicWrite.*exposeSensitive.*ownerFromClient/s)
  })

  test('a filler reason is rejected', () => {
    assert.ok(ids(file, noOwner({ noOwner: 'ok' })).includes('unsafe-invalid'))
    assert.ok(ids(file, noOwner({ noOwner: '               ' })).includes('unsafe-invalid'))
  })

  test('a filler reason does not count as unsafe.noOwner', () => {
    assert.ok(ids(file, noOwner({ noOwner: 'ok' })).includes('owner-required'))
  })

  test('unsafe that is not an object', () => {
    assert.ok(ids(file, routeWith(file, { unsafe: 'yes' })).includes('unsafe-invalid'))
  })

  test('exposeSensitive that is not a map of field to reason', () => {
    const output = z.object({ id: z.string(), apiKey: z.string() })
    const def = routeWith('users.$id.delete.ts', { output, unsafe: { exposeSensitive: 'apiKey' } })
    assert.deepEqual(ids('users.$id.delete.ts', def).sort(), ['sensitive-field', 'unsafe-invalid'])
  })

  test('exposeSensitive needs a reason per field', () => {
    const output = z.object({ id: z.string(), apiKey: z.string() })
    const def = routeWith('users.$id.delete.ts', { output, unsafe: { exposeSensitive: { apiKey: 'x' } } })
    assert.deepEqual(ids('users.$id.delete.ts', def).sort(), ['sensitive-field', 'unsafe-invalid'])
  })
})

describe('rule 14: unsafe-used', () => {
  test('every unsafe key and every exposed field warns once', () => {
    const output = z.object({ id: z.string(), apiKey: z.string(), sessionToken: z.string() })
    const def = routeWith('users.$id.delete.ts', {
      output,
      unsafe: {
        exposeSensitive: {
          apiKey: 'shown once right after creation',
          sessionToken: 'returned to the same device only',
        },
      },
    })
    const result = analyzeRoute('users.$id.delete.ts', def)
    assert.deepEqual(result.violations.map((v) => [v.id, v.severity]), [
      ['unsafe-used', 'warning'],
      ['unsafe-used', 'warning'],
    ])
    assert.equal(result.unsafeCount, 2)
  })
})

describe('rule 15: params-mismatch', () => {
  test('a param route without input.params', () => {
    assert.deepEqual(ids('orders.$id.delete.ts', routeWith('orders.$id.delete.ts', { input: {} })), ['params-mismatch'])
  })

  test('input.params missing a path param', () => {
    const def = routeWith('orders.$id.delete.ts', { input: { params: z.object({ orderId: z.string() }) } })
    assert.deepEqual(ids('orders.$id.delete.ts', def), ['params-mismatch'])
  })

  test('input.params with a key that is not in the path', () => {
    const def = routeWith('orders.$id.delete.ts', { input: { params: z.object({ id: z.string(), tenant: z.string() }) } })
    assert.deepEqual(ids('orders.$id.delete.ts', def), ['params-mismatch'])
  })

  test('input.params on a route without path params', () => {
    assert.deepEqual(ids('orders.get.ts', routeWith('orders.get.ts', { input: { params: idParams } })), ['params-mismatch'])
  })
})

describe('what the agent sees', () => {
  const failing: Array<[string, unknown]> = [
    ['orders.get.ts', undefined],
    ['orders.get.ts', routeWith('orders.get.ts', { owner: undefined })],
    ['orders.$id.delete.ts', routeWith('orders.$id.delete.ts', { load: undefined })],
    ['users.$id.delete.ts', routeWith('users.$id.delete.ts', { owner: 'id' })],
    ['users.$id.delete.ts', routeWith('users.$id.delete.ts', { output: z.object({ passwordHash: z.string() }) })],
    ['orders.post.ts', routeWith('orders.post.ts', { input: { body: z.object({ userId: z.string() }) } })],
    ['orders.post.ts', routeWith('orders.post.ts', { output: z.any() })],
    ['orders.get.ts', routeWith('orders.get.ts', { output: order })],
    ['orders/x.get.ts', validRoutes['orders.get.ts']],
    ['orders.post.ts', routeWith('orders.post.ts', { output: z.object({ id: z.string() }) })],
    ['orders.get.ts', routeWith('orders.get.ts', { unsafe: { nope: 'a reason that is long enough' } })],
    ['orders.$id.delete.ts', routeWith('orders.$id.delete.ts', { input: {} })],
  ]

  test('every error carries a fix and names its file and rule number', () => {
    for (const [file, def] of failing) {
      const errors = analyzeRoute(file, def).violations.filter((v) => v.severity === 'error')
      assert.ok(errors.length > 0, `${file} should fail`)
      for (const error of errors) {
        assert.ok(error.fix && error.fix.trim().length > 0, `${error.id} in ${file} has no fix`)
        assert.equal(error.file, file)
        assert.ok(error.rule >= 1 && error.rule <= 15)
      }
    }
  })

  test('analyzeRoute is deterministic', () => {
    const def = routeWith('orders.get.ts', { owner: undefined, output: z.any() })
    assert.deepEqual(analyzeRoute('orders.get.ts', def), analyzeRoute('orders.get.ts', def))
  })
})
