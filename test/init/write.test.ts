import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeProject } from '../../src/init/write.ts'

function withTempDir(run: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owned-init-'))
    try {
      await run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const files = [
  { path: 'a.txt', content: 'a\n' },
  { path: 'nested/deep/b.txt', content: 'b\n' },
]

test(
  'writes every file, creating directories',
  withTempDir(async (dir) => {
    assert.deepEqual(await writeProject(dir, files), { created: ['a.txt', 'nested/deep/b.txt'], skipped: [] })
    assert.equal(readFileSync(join(dir, 'nested/deep/b.txt'), 'utf8'), 'b\n')
  }),
)

test(
  'never overwrites an existing file',
  withTempDir(async (dir) => {
    writeFileSync(join(dir, 'a.txt'), 'mine\n')
    assert.deepEqual(await writeProject(dir, files), { created: ['nested/deep/b.txt'], skipped: ['a.txt'] })
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'mine\n')
  }),
)

test(
  'running it twice ends in the same state',
  withTempDir(async (dir) => {
    await writeProject(dir, files)
    assert.deepEqual(await writeProject(dir, files), { created: [], skipped: ['a.txt', 'nested/deep/b.txt'] })
  }),
)
