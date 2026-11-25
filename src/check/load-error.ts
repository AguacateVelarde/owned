import { extname, join, relative } from 'node:path'
import { violation, type Violation } from '../contract/rules.ts'

export interface LoadFailure {
  name: string
  code: string | undefined
  message: string
}

const MISSING_MODULE = /Cannot find module '([^']+)'/
const MISSING_PACKAGE = /Cannot find package '([^']+)'/

export const ENUM_FIX = `const Status = { Open: 'open', Closed: 'closed' } as const
type Status = (typeof Status)[keyof typeof Status]`

const PARAMETER_PROPERTY_FIX = `class Example {
  x: number
  constructor(x: number) {
    this.x = x
  }
}`

const LAZY_INIT_FIX = `move side effects out of the module top level:
let db: Db | undefined
export function getDb(): Db {
  db ??= connect(process.env.DATABASE_URL)
  return db
}
owned check imports routes with OWNED_CHECK=1, so code that must run at import time can skip work when it is set`

function asImportSpecifier(fromDir: string, target: string): string {
  const spec = relative(fromDir, target).split('\\').join('/')
  return spec.startsWith('.') ? spec : `./${spec}`
}

const JS_EXTENSIONS = new Set(['.js', '.mjs'])

function tsCandidate(missing: string): string {
  const ext = extname(missing)
  if (ext === '') return `${missing}.ts`
  return JS_EXTENSIONS.has(ext) ? `${missing.slice(0, -ext.length)}.ts` : missing
}

function moduleNotFound(root: string, file: string, missing: string, fileExists: (path: string) => boolean): Violation {
  const routesDir = join(root, 'routes')
  const withTs = tsCandidate(missing)
  const written = asImportSpecifier(routesDir, missing)
  const spec = asImportSpecifier(routesDir, withTs)
  if (fileExists(withTs)) {
    return violation(
      'module-load',
      file,
      `cannot find '${written}': Node needs the file extension on relative imports`,
      `import ... from '${spec}'`,
    )
  }
  return violation('module-load', file, `cannot find '${written}'`, `create ${spec} or fix the import path`)
}

function unsupportedSyntax(file: string, message: string): Violation {
  const fix = /enum/.test(message)
    ? ENUM_FIX
    : /parameter property/.test(message)
      ? PARAMETER_PROPERTY_FIX
      : 'use erasable TypeScript only: no enums, namespaces with values, or parameter properties'
  return violation('module-load', file, message, fix)
}

export function translateLoadError(
  root: string,
  file: string,
  failure: LoadFailure,
  fileExists: (path: string) => boolean,
): Violation {
  const missingModule = MISSING_MODULE.exec(failure.message)?.[1]
  if (failure.code === 'ERR_MODULE_NOT_FOUND' && missingModule !== undefined) {
    return moduleNotFound(root, file, missingModule, fileExists)
  }
  const missingPackage = MISSING_PACKAGE.exec(failure.message)?.[1]
  if (failure.code === 'ERR_MODULE_NOT_FOUND' && missingPackage !== undefined) {
    return violation('module-load', file, `package ${missingPackage} is not installed`, `npm install ${missingPackage}`)
  }
  if (failure.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    return unsupportedSyntax(file, failure.message)
  }
  if (failure.name === 'SyntaxError') {
    return violation('module-load', file, failure.message, `fix the syntax error: ${failure.message}`)
  }
  return violation('module-load', file, `the module threw while being imported: ${failure.message}`, LAZY_INIT_FIX)
}
