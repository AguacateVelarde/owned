# How owned works (v1, when finished)

This is the target behavior for v1, written as if it shipped. Some of it is already built and the rest is planned. The [Status table in the README](../README.md#status) shows which part is which. When something here and the code disagree, either the code isn't done yet or this doc needs updating, and both get fixed in the same change.

---

## The whole journey

Ana is a founder building a notes app with an AI coding agent. She has never written an authorization check.

```
 1. npx owned init           project + AGENTS.md
 2. "build notes CRUD"       the agent writes routes/*.ts
 3. npx owned check --json   the agent fixes every violation, loops until 0/0
 4. npx owned dev            the server refuses to boot if the check fails
 5. npx owned audit          Ana reads a 10-second security report
 6. npx owned start          production: same guarantees, no watch
```

### 1. Start a project

```sh
mkdir notes-api && cd notes-api
npx owned init
npm install
```

`owned init` writes a project that already passes every check: `package.json`, `tsconfig.json`, `owned.config.ts`, `db.ts`, `routes/health.get.ts`, `AGENTS.md` and `CLAUDE.md`. It never overwrites a file, so running it again is safe.

### 2. Give the agent the task

Ana tells her agent: *"Add notes: users create, list and delete their own notes."* The agent reads `CLAUDE.md`, which sends it to `AGENTS.md`, which contains:

- the file convention (`routes/<segments>.<method>.ts`);
- a template for each route shape;
- every rule `owned check` enforces;
- the finishing rule: **run `npx owned check --json` after every change and stop only at 0 errors and 0 warnings; never add `unsafe` unless the human asked.**

### 3. The agent corrects itself

The agent's first attempt forgets the ownership check on delete:

```
✗ routes/notes.$id.delete.ts  [rule 3 load-required]
  /notes/:id acts on one resource; load it so owned can check that it belongs to the user
  fix:
    load: ({ params }) => getDb().notes.find(params.id),
```

It applies the fix and runs the check again. Each violation names the file, the rule and the code to paste, and the type system rejects the shortcuts: `load` can't see the user, and the handler must return what `output` declares. That leaves the agent nothing to guess. Ana never sees this loop.

### 4. Run it locally

```sh
NODE_ENV=test npx owned dev
curl -H 'x-user-id: ana' -X POST localhost:3000/notes -H 'content-type: application/json' -d '{"text":"hi"}'
curl -H 'x-user-id: bob' -X DELETE localhost:3000/notes/<ana's note id>   # 404
```

`owned dev` runs the same analysis as `owned check` and **refuses to start** if any route has an error. When it starts, it watches `routes/` and `owned.config.ts` and reloads on change, including new files.

### 5. Read the security report

```
$ npx owned audit
owned audit: a contract report, not a professional security audit

PUBLIC   GET  /health          ok
USER     GET  /notes           ok   owner: userId (filtered in memory ⚠)
USER     POST /notes           ok   owner: userId (verified in response)
USER     DEL  /notes/:id       ok   owner: userId (verified before handler)

⚠ GET /notes  filtered in memory: use where userId = ctx.user.id in your query
0 unsafe uses · 0 errors
```

Ana can read it without knowing security: who can call each route, whose data it touches, and every exception anyone made, with the reason they gave.

### 6. Deploy

```sh
npx owned start
```

It does the same analysis at boot and refuses to start if anything fails. There is no watch and no `tsc` run (that's for CI). It reads `PORT`, and stack traces never reach clients when `NODE_ENV=production`. Before deploying, Ana (or the agent) replaces the test-only branch in `owned.config.ts` with real session or token verification. Until then, every `user` and `admin` route answers 401.

---

## What happens on every request

The pipeline is fixed. Routes can't reorder it, skip steps or add their own auth.

```
 request
   │
   ▼
 authenticate(c) ──null──────────────────────► 401 unauthorized      (user/admin routes)
   │ throws ───────────────────────────────────► 500 (not 401)
   ▼
 role check ──role ≠ admin───────────────────► 403 forbidden          (admin routes)
   ▼
 parse input ──invalid / malformed JSON──────► 400 invalid_input
   │          ──wrong Content-Type───────────► 415 unsupported_media_type
   │ undeclared keys are dropped
   ▼
 load({ params }) ──null / undefined─────────► 404 not_found          (resource routes)
   ▼
 owner check ──≠ caller, or either side null─► 404 not_found          (not 403: existence isn't leaked)
   ▼
 handler({ input, resource, user })
   │ httpError(4xx) ─────────────────────────► that status
   │ anything else thrown ───────────────────► 500 internal_error, logged
   ▼
 create/action: result[owner] ≠ caller ──────► 500, logged
 list: item without owner ───────────────────► 500, logged
 list: items of other users ─────────────────► removed
   ▼
 output.parse (strip) ──doesn't match────────► 500, logged
   │ undeclared fields are removed
   ▼
 200 JSON
```

### Ownership by route shape

| Shape | Detected by | Before the handler | After the handler |
|---|---|---|---|
| **resource** | a `:param` in the path | `load` fetches by params, and the owner must be the caller (else 404) | output strip |
| **list** | `GET` without a `:param` | none | items not owned by the caller are removed, and an item missing the owner field is a 500 |
| **create / action** | other methods without a `:param` | the body can't carry the owner field (rejected by `owned check`) | the returned owner must be the caller (else 500) |

Owners are compared as `String(resource[owner]) === String(user.id)`. A `null` or `undefined` on either side is denied. `admin` routes skip the owner comparison but still get input validation and output stripping. A `user` route compares the owner even when the caller is an admin.

### The output guarantee

Whatever the handler returns, the client receives only the fields `output` declares. If the handler returns a full database row with `passwordHash`, the hash is stripped. `owned check` also refuses an `output` that *declares* a sensitive field, unless `unsafe.exposeSensitive` gives a reason.

### Errors

Every error response has the same shape:

```json
{ "error": { "code": "not_found", "message": "not found" } }
```

Invalid input adds `fields` with one message per field. For an intentional failure, the handler throws `httpError(409, 'conflict', 'title already used')`. Only 4xx statuses are accepted: anything else becomes a generic 500. Unexpected errors are logged with their details, and the client receives `internal_error` with no stack trace in production.

### Configuration

```ts
import { defineConfig } from 'owned'

export default defineConfig({
  authenticate: async (c) => {
    const session = await verifySession(c.req.header('authorization'))
    return session === null ? null : { id: session.userId, role: session.role }
  },
})
```

`authenticate`'s return value is validated: it must be `{ id: string | number, role?: string }` or `null`. Anything else is a 500, so a buggy authenticator can't produce a user without an id.

---

## The commands

| Command | Does | Fails when |
|---|---|---|
| `owned init` | scaffolds the project and `AGENTS.md` | never overwrites. Skipped files are listed. |
| `owned check [--json]` | every contract rule + `tsc --noEmit`, with fixes | any error (exit 1). Warnings don't change the exit code. |
| `owned dev` | check, then serve with reload on `routes/` and `owned.config.ts` changes | it won't start while errors exist |
| `owned start` | check at boot, then serve on `PORT` | it won't start while errors exist |
| `owned audit` | human-readable table per route: auth, owner, how ownership is verified, exposed fields, and every `unsafe` with its reason | report only. It doesn't fail. |

The full rules table is in the [README](../README.md#rules).

---

## How we know it works

Unit tests prove the checker and the runtime do what this page says. They don't prove the core claim, that an agent with `AGENTS.md` writes safer backends. So v1 ships only after an eval passes:

1. A harness creates a fresh project with `owned init`.
2. Claude Code (`claude -p`, sandboxed, explicit permissions) gets a fixed spec: a comments CRUD where each user edits only their own comments.
3. Hidden ownership tests, which live in the harness and never in the agent's repo, act as two users over HTTP with `x-user-id`. They check that A can't read, edit or delete B's comments, by id or by listing.
4. A run passes when `owned check` reports 0 errors and 0 warnings, there are no `unsafe` uses, and every hidden test passes.
5. The same prompt and the same hidden tests run against plain Hono, as the baseline.

**Release gate:** at least 2 of 3 runs pass with `owned`, **and** `owned` leaks less IDOR than the baseline. Three runs make this a smoke test, not a statistic. If the agent doesn't follow the rules, the messages or the design change before release.

The eval runs in two stages:

| Stage | Scores | Needs |
|---|---|---|
| **Compliance** (built) | `owned check` at 0 errors, 0 warnings and 0 `unsafe`; all five routes present; each one `auth: 'user'` with an `owner`; `owned.config.ts`, `tsconfig.json`, `package.json`, `AGENTS.md` and `CLAUDE.md` untouched; no direct `zod` imports | `owned check` |
| **Ownership** | hidden HTTP tests with two users, `owned` vs plain Hono | the runtime |

The compliance stage runs first because it tests the riskiest premise, that the agent follows the rules, before the runtime is built.

Before v1 ships there will also be an example app with three planted bugs (a delete without an owner check, a `passwordHash` in an output, an owner id taken from the body), plus an end-to-end test that runs two real users against it.

---

## Distribution

- npm package `owned`, compiled to JavaScript (Node doesn't strip types inside `node_modules`), with `typescript` as a peer dependency.
- `npx owned init` is the entry point. The binary is `owned`.
- CI runs `tsc --noEmit` and the tests on every PR, and publishes with provenance on `v*` tags.

---

## After v1

| Planned | What it adds |
|---|---|
| `owned attack` | Two synthetic users probe every route: A against B's resources, anonymous against admin, and a search for undeclared fields in responses. Can report as a PR diff: "this change made DELETE /notes/:id public". |
| Scoped database (`ctx.db`) | Queries are filtered by the current user by construction, which replaces in-memory list filtering and closes unfiltered writes inside handlers. |
| Pagination with totals | Lists of the form `{ items, total }`, once filtering happens in the query. |
| Real rate limiting | `rateLimit` gets enforced, not just declared. |
| Configurable roles | Beyond `admin`. |
| MCP server | Agents query routes, contracts and violations directly. |

## Limits, even when finished

- `owned` enforces the contract. It can't see logic bugs inside a handler: a handler that deletes the wrong row through a raw query is still wrong. The scoped database after v1 narrows this.
- Ownership is one field compared with the user id. Team or nested ownership is out of scope for v1.
- `owned audit` reports what the contracts declare and the framework enforces. It isn't a penetration test.
