import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRouteFile } from '../src/contract/route-file.ts'

test('parses valid route files', () => {
  assert.deepEqual(parseRouteFile('index.get.ts'), {
    ok: true,
    route: { method: 'get', path: '/', params: [], staticSegments: 0 },
  })
  assert.deepEqual(parseRouteFile('products.get.ts'), {
    ok: true,
    route: { method: 'get', path: '/products', params: [], staticSegments: 1 },
  })
  assert.deepEqual(parseRouteFile('orders.$id.delete.ts'), {
    ok: true,
    route: { method: 'delete', path: '/orders/:id', params: ['id'], staticSegments: 1 },
  })
  assert.deepEqual(parseRouteFile('users.$userId.orders.get.ts'), {
    ok: true,
    route: { method: 'get', path: '/users/:userId/orders', params: ['userId'], staticSegments: 2 },
  })
  assert.deepEqual(parseRouteFile('password-reset.post.ts'), {
    ok: true,
    route: { method: 'post', path: '/password-reset', params: [], staticSegments: 1 },
  })
})

test('static routes have more static segments than their param twins', () => {
  const me = parseRouteFile('users.me.get.ts')
  const byId = parseRouteFile('users.$id.get.ts')
  assert.ok(me.ok && byId.ok)
  assert.ok(me.route.staticSegments > byId.route.staticSegments)
})

test('rejects invalid route files with a reason', () => {
  const bad = [
    'users/$id.get.ts',
    'orders.get.js',
    'orders.fetch.ts',
    'get.ts',
    'orders..get.ts',
    'Orders.get.ts',
    'orders.$1.get.ts',
    'orders.$id.$id.get.ts',
    'users.index.get.ts',
  ]
  for (const file of bad) {
    const result = parseRouteFile(file)
    assert.equal(result.ok, false, file)
    assert.ok(!result.ok && result.reason.length > 0, file)
  }
})
