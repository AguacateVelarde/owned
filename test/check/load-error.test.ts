import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateLoadError } from '../../src/check/load-error.ts'

const root = '/app'
const file = 'orders.get.ts'
const nothingExists = () => false

function failure(name: string, code: string | undefined, message: string) {
  return { name, code, message }
}

test('an extensionless relative import suggests the .ts extension when the file exists', () => {
  const v = translateLoadError(
    root,
    file,
    failure('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find module '/app/db' imported from /app/routes/orders.get.ts"),
    (path) => path === '/app/db.ts',
  )
  assert.equal(v.id, 'module-load')
  assert.equal(v.severity, 'error')
  assert.match(v.message, /cannot find '\.\.\/db'/)
  assert.doesNotMatch(v.message, /\/app\//)
  assert.match(v.fix, /'\.\.\/db\.ts'/)
})

test('a relative import of a file that does not exist says so', () => {
  const v = translateLoadError(
    root,
    file,
    failure('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find module '/app/lib/missing.ts' imported from /app/routes/orders.get.ts"),
    nothingExists,
  )
  assert.match(v.fix, /create \.\.\/lib\/missing\.ts or fix the import path/)
})

test('a missing package suggests installing it', () => {
  const v = translateLoadError(
    root,
    file,
    failure('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find package 'left-pad' imported from /app/routes/orders.get.ts"),
    nothingExists,
  )
  assert.match(v.fix, /npm install left-pad/)
})

test('an enum suggests an as const object', () => {
  const v = translateLoadError(
    root,
    file,
    failure('SyntaxError', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', 'TypeScript enum is not supported in strip-only mode'),
    nothingExists,
  )
  assert.match(v.message, /enum/)
  assert.match(v.fix, /as const/)
})

test('a parameter property suggests assigning in the constructor body', () => {
  const v = translateLoadError(
    root,
    file,
    failure('SyntaxError', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', 'TypeScript parameter property is not supported in strip-only mode'),
    nothingExists,
  )
  assert.match(v.fix, /this\.x = x/)
})

test('other unsupported TypeScript syntax points at erasable syntax', () => {
  const v = translateLoadError(
    root,
    file,
    failure('SyntaxError', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', 'TypeScript namespace declaration is not supported in strip-only mode'),
    nothingExists,
  )
  assert.match(v.fix, /erasable/)
})

test('invalid syntax passes the parser message through', () => {
  const v = translateLoadError(
    root,
    file,
    failure('SyntaxError', 'ERR_INVALID_TYPESCRIPT_SYNTAX', 'Unexpected token `<eof>`. Expected identifier'),
    nothingExists,
  )
  assert.match(v.message, /Unexpected token/)
  assert.match(v.fix, /syntax error/)
})

test('a module that throws on import suggests lazy initialization', () => {
  const v = translateLoadError(root, file, failure('Error', undefined, 'ECONNREFUSED 127.0.0.1:5432'), nothingExists)
  assert.match(v.message, /ECONNREFUSED/)
  assert.match(v.fix, /getDb\(\)/)
  assert.match(v.fix, /OWNED_CHECK/)
})

test('the violation is reported against the route file', () => {
  const v = translateLoadError(root, file, failure('Error', undefined, 'boom'), nothingExists)
  assert.equal(v.file, file)
  assert.equal(v.rule, 16)
})

test('an import of a sibling file inside routes/ keeps the ./ prefix', () => {
  const v = translateLoadError(
    root,
    file,
    failure('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find module '/app/routes/helpers' imported from /app/routes/orders.get.ts"),
    (path) => path === '/app/routes/helpers.ts',
  )
  assert.match(v.message, /cannot find '\.\/helpers'/)
  assert.match(v.fix, /'\.\/helpers\.ts'/)
})

test('a .js import of a .ts file suggests the .ts extension', () => {
  const v = translateLoadError(
    root,
    file,
    failure('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find module '/app/db.js' imported from /app/routes/orders.get.ts"),
    (path) => path === '/app/db.ts',
  )
  assert.match(v.message, /cannot find '\.\.\/db\.js'/)
  assert.match(v.fix, /'\.\.\/db\.ts'/)
})
