# owned

> Ship APIs that don't get owned.

`owned` is a secure-by-default API framework for Node.js and TypeScript, built on [Hono](https://hono.dev). It is designed for the way backends get written now: an AI coding agent writes the code for someone who doesn't know security.

Every route declares a **contract**: who can call it, what it accepts, what it returns, and which field says who owns the data. `owned` checks that contract before the code runs and (soon) enforces it at runtime. Insecure routes are hard to write and easy to spot, even when neither the human nor the agent knows anything about security.

> **Status: in development (v0).** `owned init` and `owned check` work today. The runtime (`owned dev`, `owned start`) and `owned audit` are next. The package name is reserved on npm, but nothing usable is published yet. See [Status](#status), and [How owned works when v1 is finished](docs/HOW-IT-WORKS.md) for the full target design.

---

## Why

When an agent writes an API in Express, Nest or Fastify, the same things go wrong:

1. **It invents or mixes patterns.** Every endpoint validates, authenticates and returns errors differently.
2. **It breaks things without noticing.** A change makes a route public or exposes a field, and nothing flags it.
3. **It gets lost in the project.** It burns tokens reading files to figure out where things go.
4. **It can't verify its own work.** There is no fast, deterministic check, so it says "done" without testing.

The most common flaw in agent-built apps is **broken authorization**, especially missing ownership checks (IDOR): user A can read or delete user B's data by changing an id in the URL. Static scanners for Express can't catch it, because an Express route never declares who owns what.

`owned` makes the route declare it. The checker can then verify it exactly, without guessing, and the framework can enforce it.

## Quick start

`owned` isn't usable from npm yet. To try it from a clone:

```sh
git clone https://github.com/AguacateVelarde/owned.git
cd owned && npm install

mkdir ../my-api && cd ../my-api
node ../owned/bin/owned.ts init
npm install ../owned typescript @types/node
npx owned check
```

Once it's published, the flow is:

```sh
mkdir my-api && cd my-api
npx owned init
npm install
npx owned check
```

Then point your agent at the project. `owned init` writes an `AGENTS.md` (and a `CLAUDE.md` that points to it) telling the agent exactly how to write routes and to keep running `npx owned check --json` until it reports 0 errors and 0 warnings.

Requires **Node ≥ 22.18**. `owned` uses Node's built-in TypeScript type stripping, so there is no `tsx` and no build step for your code.

## How it works

```
 routes/notes.$id.delete.ts
          │
          ▼
 ┌─────────────────────────────┐   owned check   ┌──────────────────────────────┐
 │ export default defineRoute({│ ──────────────► │ every rule + tsc --noEmit    │
 │   auth, input, output,      │                 │ violations with exact fixes  │
 │   owner, load, handler      │                 │ (the agent fixes itself)     │
 │ })                          │                 └──────────────────────────────┘
 └─────────────────────────────┘
          │  owned dev / start (planned)
          ▼
 auth → validate input → load → owner check → handler → owner verification → strip output
```

### 1. One file per route

Routes live in `routes/`. The file name is the route:

```
<segments>.<method>.ts  e.g. products.get.ts -> GET /products
$<param> for a path param  e.g. orders.$id.delete.ts -> DELETE /orders/:id
index.<method>.ts for the root  e.g. index.get.ts -> GET /
<method> is one of: get, post, put, patch, delete
```

Subdirectories aren't supported. Static segments win over params, so `users.me.get.ts` is matched before `users.$id.get.ts`.

### 2. Every route declares a contract

| Field | Required | Meaning |
|---|---|---|
| `auth` | always | `'public'` (anyone), `'user'` (logged in) or `'admin'` (logged in with role `admin`). |
| `input` | always | Zod schemas for `params`, `query` and `body`. Use `{}` when there is no input. Undeclared keys are dropped. |
| `output` | always | A Zod schema for exactly what the client may see. Everything else is removed before responding. |
| `owner` | on `user` routes | The field that holds the owning user's id, e.g. `'userId'`. |
| `load` | on `user` routes with a `:param` | Fetches the resource by `params`. It never sees the user, so it can't fake ownership. |
| `handler` | always | Your logic. It receives typed `input`, the loaded `resource` and the `user`. |
| `rateLimit` | optional | `{ max, windowSec }`. Expected on login, register and reset routes. |
| `unsafe` | optional | The only escape hatch. See [Escape hatches](#escape-hatches-unsafe). |

Import everything from `owned`, never from `zod` directly:

```ts
import { defineRoute, z } from 'owned'
```

Types are inferred end to end. `input.params` is typed from its schema, `resource` from what `load` returns (never `null`: the server answers 404 before your handler runs), `user` is non-optional on `user` and `admin` routes, and the handler must return what `output` declares.

### 3. Ownership is decided by the route's shape

The shape comes from the **method and the path**, never from the output schema, so it can't be dodged by reshaping the response:

| Shape | Detected by | How ownership is enforced |
|---|---|---|
| **resource** | the path has a `:param` | `load` fetches the resource. If it doesn't exist, or its `owner` field isn't the caller, the answer is **404**, and the handler never runs. |
| **list** | `GET` without a `:param` | The output must be an array. Items whose `owner` field isn't the caller are filtered out. |
| **create / action** | `POST`, `PUT`, `PATCH`, `DELETE` without a `:param` | The body may not carry the owner field. The response must include it, and it must be the caller. |

Owners are compared as `String(resource[owner]) === String(user.id)`. If either side is `null` or `undefined`, access is denied.

### 4. Examples

These are the templates `owned init` ships in `AGENTS.md`.

**Public route:** anyone can call it, no owner. `routes/health.get.ts`

```ts
import { defineRoute, z } from 'owned'

export default defineRoute({
  auth: 'public',
  input: {},
  output: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true }),
})
```

**List route:** returns only the caller's items. `routes/notes.get.ts`

```ts
import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: {},
  owner: 'userId',
  output: z.array(z.object({ id: z.string(), userId: z.string(), text: z.string() })),
  handler: ({ user }) => getDb().notes.where((note) => note.userId === String(user.id)),
})
```

**Create route:** the owner comes from the logged-in user, never from the body. `routes/notes.post.ts`

```ts
import { defineRoute, z } from 'owned'
import { getDb } from '../db.ts'

export default defineRoute({
  auth: 'user',
  input: { body: z.object({ text: z.string().min(1) }) },
  owner: 'userId',
  output: z.object({ id: z.string(), userId: z.string(), text: z.string() }),
  handler: ({ input, user }) =>
    getDb().notes.insert({ id: crypto.randomUUID(), userId: String(user.id), text: input.body.text }),
})
```

**Resource route:** `load` fetches by params, and `owned` checks the owner before the handler. `routes/notes.$id.delete.ts`

```ts
import { defineRoute, z } from 'owned'
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
```

### 5. Schemas must be closed

`output`, `input.body`, `input.query` and `input.params` can't use schemas that let undeclared data through: `z.looseObject`, `.passthrough()`, `.catchall()`, `z.record`, `z.any` and `z.unknown`. Types that can't be inspected, such as `z.bigint` or a bare `.transform()` without `.pipe()`, aren't allowed either. Nullables, unions, enums, dates, defaults and recursive schemas are fine.

Output fields whose names look like secrets (`password`, `hash`, `secret`, `token`, `apiKey`, `ssn`) are errors unless explicitly allowed.

### Escape hatches: `unsafe`

Sometimes a route really is an exception: `GET /me` has no owner field, and a demo endpoint might really be publicly writable. All exceptions go in a single block, each with a reason:

```ts
unsafe: {
  noOwner: 'returns only the current user',
}
```

| Key | Allows |
|---|---|
| `noOwner` | a `user` route without an `owner` |
| `publicWrite` | `DELETE` / `PUT` / `PATCH` with `auth: 'public'` |
| `exposeSensitive` | `{ fieldPath: reason }` for sensitive-looking output fields |
| `ownerFromClient` | a body that carries the owner field |

A reason must be at least 15 characters ("ok" doesn't count), unknown keys are errors, and **every use is a warning**. Because the agent is told to finish only at 0 warnings, it can't use `unsafe` to turn the check green. `grep -r "unsafe:" routes/` shows every risk in the project.

## Commands

```
usage: owned init
       owned check [--json]
```

### `owned init`

Creates a project in the current directory:

| File | What it is |
|---|---|
| `package.json` | An ESM project with `engines.node >= 22.18`, depending on `owned` and `typescript`. |
| `tsconfig.json` | `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` and `noEmit`: the flags Node's type stripping needs. |
| `owned.config.ts` | `authenticate(c)` turns a request into `{ id, role }` or `null`. The generated version reads `x-user-id` / `x-user-role` **only when `NODE_ENV=test`** and returns `null` otherwise. Replace it with real session or token verification. |
| `db.ts` | An in-memory store behind a lazy `getDb()`. Swap in your database, but keep it lazy. |
| `routes/health.get.ts` | A public example route. |
| `AGENTS.md`, `CLAUDE.md` | Instructions for the agent, generated from the same rules `owned check` enforces. |

It never overwrites an existing file. Running it twice changes nothing.

### `owned check`

Run it from the project root. It:

1. finds every file in `routes/`;
2. imports each one with Node's native type stripping, with `OWNED_CHECK=1` set so modules can skip import-time side effects;
3. checks every contract rule;
4. runs `tsc --noEmit` with the project's own TypeScript. It never writes `.js` files, even if your `tsconfig.json` would.

Each problem is reported with the fix to apply:

```
✗ routes/orders.$id.delete.ts  [rule 3 load-required]
  /orders/:id acts on one resource; load it so owned can check that it belongs to the user
  fix:
    load: ({ params }) => getDb().orders.find(params.id),

✗ routes/users.$id.get.ts  [rule 6 sensitive-field]
  output exposes passwordHash, which looks like a secret
  fix:
    remove passwordHash from output, or:
    unsafe: { exposeSensitive: { 'passwordHash': '<why it is safe to expose>' } },

✗ routes/history.get.ts  [rule 16 module-load]
  cannot find '../db': Node needs the file extension on relative imports
  fix:
    import ... from '../db.ts'
```

Problems Node hits before the contract can even be read are translated too: a missing `.ts` extension, a `.js` import of a `.ts` file, a missing package, `enum`, constructor parameter properties, syntax errors, and modules that connect to a database at import time.

`--json` prints a machine-readable report for agents:

```json
{
  "ok": false,
  "errors": 1,
  "warnings": 0,
  "unsafeCount": 0,
  "routes": [{ "file": "routes/orders.$id.delete.ts", "method": "delete", "path": "/orders/:id", "shape": "resource" }],
  "violations": [{ "rule": 3, "id": "load-required", "severity": "error", "file": "routes/orders.$id.delete.ts", "message": "...", "fix": "..." }]
}
```

| Exit code | Meaning |
|---|---|
| `0` | no errors (warnings don't fail the command) |
| `1` | at least one error |
| `2` | usage error, or no `routes/` directory |

### Rules

| # | id | severity | rule |
|---|---|---|---|
| 1 | `contract-missing` | error | auth, input, output and handler are required |
| 2 | `owner-required` | error | user routes declare an owner (or unsafe.noOwner) |
| 3 | `load-required` | error | routes with a :param load the resource they act on |
| 4 | `owner-not-applicable` | error | admin and public routes do not declare an owner |
| 5 | `public-write` | error | DELETE/PUT/PATCH are not public (or unsafe.publicWrite) |
| 6 | `sensitive-field` | error | no sensitive fields in output (or unsafe.exposeSensitive) |
| 7 | `owner-from-client` | error | the body does not carry the owner field (or unsafe.ownerFromClient) |
| 8 | `open-schema` | error | input and output schemas are closed and supported |
| 9 | `list-output-array` | error | list routes with an owner return an array at the root |
| 10 | `file-name` | error | route files follow <segments>.<method>.ts |
| 11 | `auth-rate-limit` | warning | login/register/reset routes declare a rateLimit |
| 12 | `owner-in-output` | error | create/action routes with an owner return the owner field |
| 13 | `unsafe-invalid` | error | unsafe uses known keys with real reasons |
| 14 | `unsafe-used` | warning | every use of unsafe is reported |
| 15 | `params-mismatch` | error | input.params declares exactly the path params |
| 16 | `module-load` | error | route modules load under Node type stripping without side effects |
| 17 | `typecheck` | error | the project typechecks with tsc --noEmit |
| 17 | `typecheck-skipped` | warning | tsc could not run, so type errors were not checked |

This table is generated from the same source as the checker, and a test fails if it drifts.

## Status

| Piece | State |
|---|---|
| Contract checker (all rules above) | ✅ done |
| `owned check` (native loading, Node error translation, `tsc`, `--json`) | ✅ done |
| Typed `defineRoute` / `defineConfig` | ✅ done |
| `owned init` + generated `AGENTS.md` | ✅ done |
| Agent eval: Claude Code builds a CRUD from `AGENTS.md` alone, scored by hidden ownership tests and compared against plain Hono | ⏳ next. This gates the release. |
| Runtime pipeline on Hono (auth → input → load → owner → handler → strip), file-based loader | ⏳ planned |
| `owned dev` / `owned start` (refuse to boot when the check fails) | ⏳ planned |
| `owned audit`: a security report a human can read in 10 seconds | ⏳ planned |
| Example app with planted bugs + end-to-end ownership tests | ⏳ planned |
| Published npm release with CI | ⏳ planned |

Later (v2): `owned attack` (two synthetic users try to reach each other's data), a database layer scoped to the current user, pagination with totals, real rate limiting, configurable roles. See [TODOS.md](TODOS.md).

### Known limits

- Ownership is a single field compared with the user id. Nested or team-based ownership isn't supported yet.
- `admin` means `user.role === 'admin'`. Roles aren't configurable yet.
- `rateLimit` is declared and checked for presence, but not enforced yet.
- `owned check` isn't a professional security audit. It enforces the contract. Logic bugs inside a handler are still yours.

## Development

```sh
npm install
npm test            # node:test, TypeScript run natively
npm run typecheck   # tsc --noEmit
```

```
bin/owned.ts          CLI entry
src/index.ts          public API: defineRoute, defineConfig, z
src/define.ts         route and config types
src/cli.ts            argv parsing and commands
src/contract/         analyzeRoute: route-file parsing, contract parsing, rules, schema inspection
src/check/            owned check: loading, error translation, tsc, output
src/init/             owned init: templates, AGENTS.md, file writing
test/                 unit, type, CLI end-to-end tests and fixture projects
docs/                 ARCHITECTURE.md, GLOSSARY.md
```

The target behavior for v1 is in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md). Conventions: tests come first, the code has no comments (the reasoning lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), every violation ships with a fix, and coverage stays at 100% of lines. Domain terms are defined in [docs/GLOSSARY.md](docs/GLOSSARY.md).

## License

[MIT](LICENSE)
