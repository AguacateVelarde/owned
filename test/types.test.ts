import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const typesDir = (path: string) => fileURLToPath(new URL(`./types/${path}`, import.meta.url))

function compile(file: string): { code: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [
      tsc,
      '--noEmit',
      '--ignoreConfig',
      '--pretty',
      'false',
      '--strict',
      '--target',
      'ES2023',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--types',
      'node',
      '--allowImportingTsExtensions',
      '--skipLibCheck',
      typesDir(file),
    ],
    { encoding: 'utf8' },
  )
  return { code: result.status, output: result.stdout }
}

test('the public route API infers params, body, resource and user', () => {
  const { code, output } = compile('positive.ts')
  assert.equal(code, 0, output)
})

const mustNotCompile: Array<[string, string, string]> = [
  ['load-sees-user.ts', 'TS2339', 'load never sees the user, so it cannot fabricate ownership'],
  ['handler-returns-wrong-type.ts', 'TS2322', 'the handler must return what output declares'],
  ['unknown-auth.ts', 'TS2322', 'auth is one of public, user, admin'],
  ['authenticate-without-id.ts', 'TS2322', 'authenticate returns a user with an id, or null'],
]

for (const [file, code, why] of mustNotCompile) {
  test(`does not compile: ${why}`, () => {
    const result = compile(`negative/${file}`)
    assert.notEqual(result.code, 0, `${file} compiled but should not`)
    assert.match(result.output, new RegExp(`negative/${file.replace('.', '\\.')}\\(\\d+,\\d+\\): error ${code}`), result.output)
  })
}
