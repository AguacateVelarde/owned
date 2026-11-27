import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectFile } from './templates.ts'

export interface WriteResult {
  created: string[]
  skipped: string[]
}

function alreadyExists(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'EEXIST'
}

export async function writeProject(dir: string, files: readonly ProjectFile[]): Promise<WriteResult> {
  const result: WriteResult = { created: [], skipped: [] }
  for (const file of files) {
    const target = join(dir, file.path)
    await mkdir(dirname(target), { recursive: true })
    try {
      await writeFile(target, file.content, { flag: 'wx' })
      result.created.push(file.path)
    } catch (error) {
      if (!alreadyExists(error)) throw error
      result.skipped.push(file.path)
    }
  }
  return result
}
