# Architecture

## Contract checker (`src/contract/`)

```
 route file name ──parseRouteFile──► method, path, params ──classifyShape──► resource | list | action
                                                                                   │
 default export (unknown) ──parseContract──► Contract (trusted) ───────────────────┤
                                                                                   ▼
                                              toJsonSchema(output, input) ──► CHECKS (pure) ──► Violation[]
```

`analyzeRoute(file, def)` is the single source of truth. `defineRoute`, `owned check`, `owned dev`, `owned start` and `owned audit` all call it, so no rule is implemented twice.

| Module | Responsibility |
|---|---|
| `route-file.ts` | Parses `<segments>.<method>.ts` into a Hono path. Counts static segments so static routes register before param routes (`users.me.get.ts` wins over `users.$id.get.ts`). |
| `contract.ts` | The boundary. Parses the agent-written default export from `unknown` into a typed `Contract` exactly once. Shape problems become rule 1; bad `unsafe` entries become rule 13 and are dropped, so a filler reason never counts as an exception. |
| `schema.ts` | Converts Zod to JSON Schema and finds open or unsupported nodes. |
| `checks.ts` | One pure function per rule over the trusted `Contract`. |
| `rules.ts` | Rule ids, numbers, severities and titles, plus shared constants (sensitive-field regex, auth routes, minimum reason length). |
| `analyze.ts` | Composes the above. |

Every `Violation` carries a `fix`: the type requires it, because the fix text is what the agent reads to correct itself.

### Route shape

Decided by method and path only, never by the output schema, so an agent cannot dodge list filtering by wrapping the output in an object.

| Shape | Rule |
|---|---|
| `resource` | the path has a `:param` (any method) |
| `list` | `GET` without a `:param` |
| `action` | `POST`/`PUT`/`PATCH`/`DELETE` without a `:param` |

### Open-schema detection

Built on Zod v4's public `z.toJSONSchema()`, not the `_zod.def` internals. The exact shapes it relies on are pinned in `test/schema.fixtures.test.ts`, so a Zod upgrade that changes them fails there first.

A node is **open** when:
- it accepts anything: `{}` or `true` (`z.any()`, `z.unknown()`), or
- `additionalProperties` is present and not `false` (`looseObject`, `passthrough`, `catchall`, `record`).

A node is **not** open when:
- it has no `type`. Nullables, unions and `$ref`s are emitted that way.
- it is an input-side `z.object` without `additionalProperties`. Zod strips extra keys on parse, so they never reach the handler.

`unrepresentable: 'any'` turns both `z.any()` and types like `z.bigint()` into `{}`. The `override` hook tells them apart with the schema's public `.type`:
- `date` becomes `{ type: 'string', format: 'date-time' }`.
- Unrepresentable types get an `x-owned-unsupported` marker.
- Wrappers such as `optional` or `default` are left alone, because they are `{}` only when their inner type is open.

The walker does not follow `$ref`. `#` points back at the root, which has already been walked, and `#/$defs/X` is walked through `$defs`. That is why recursive schemas terminate.

On the output side, a bare `.transform()` is unsupported because its output shape is unknown. Adding `.pipe(<schema>)` makes it inspectable.

## `owned check` (`src/check/`, `src/cli.ts`, `bin/owned.ts`)

```
 argv ──parseArgs──► check [--json]
                        │
                        ▼
 routes/ (recursive) ──► each file ──► .ts? ──import (OWNED_CHECK=1)──► analyzeRoute
                                        │              │
                                        │              └─ throws ──translateLoadError──► rule 16
                                        └─ not .ts ──analyzeRouteFile──► rule 10
                        │
 tsconfig.json + project typescript ──tsc --noEmit──parseTscOutput──► rule 17
                        │
                        ▼
              formatHuman / formatJson ──► exit 0 (no errors) · 1 (errors) · 2 (usage)
```

| Module | Responsibility |
|---|---|
| `cli.ts` | Parses argv once. Sets `OWNED_CHECK=1` so route modules can skip import-time side effects. Maps the outcome to an exit code. |
| `check/run.ts` | Walks `routes/`, imports each `.ts` file with Node's native type stripping, runs `analyzeRoute`, then the typecheck. Rewrites every path to be relative to the project root. |
| `check/load-error.ts` | Turns a failed import into a fix: extensionless or `.js` imports → `.ts`, missing package → `npm install`, `enum` → `as const` object, parameter property → constructor assignment, top-level throw → lazy `getDb()`. |
| `check/typecheck.ts` | Resolves `typescript` from the project (not from `owned`), runs `tsc --noEmit --pretty false`, and parses each diagnostic and its continuation lines. If there is no `tsconfig.json` or no `typescript`, it reports a `typecheck-skipped` warning instead of passing silently. `--noEmit` is always passed, so a check never writes `.js` files. |
| `check/format.ts` | Human output (errors before warnings, indented fixes, summary line) and the `--json` report (`ok`, counts, routes, violations). |

Warnings don't change the exit code, but `AGENTS.md` tells the agent to finish only at 0 errors **and** 0 warnings, so `unsafe` and a skipped typecheck can't be ignored.

## Public API (`src/index.ts`, `src/define.ts`)

`import { defineRoute, defineConfig, z } from 'owned'`. At runtime, `defineRoute` and `defineConfig` return what they're given. All the value is in the types:

| Inferred | From | Why |
|---|---|---|
| `A` (auth level) | `auth` as a literal | `user` is `AuthUser` on `user` and `admin` routes, `AuthUser \| undefined` on `public` routes. |
| `P`, `Q`, `B` | `input.params`, `input.query`, `input.body` | The handler gets parsed, typed input. Missing keys are `undefined`. |
| `R` | `load`'s return value | `resource` drops `null` and `undefined`, because the runtime answers 404 before the handler runs. Otherwise agents would write `resource!`. |
| `I` | `output: ZodType<unknown, I>` | The handler returns `I`. Typing the return as `z.input<O>` widened literals (`true` became `boolean`) while `O` was still being inferred, so the generic is the input type itself. |

`load` receives only `{ params }`, never the user. Because it can't see who is asking, it can't fabricate a resource that passes the owner check.

Type behavior is pinned by `test/types.test.ts`. It compiles `test/types/positive.ts`, and asserts that each file in `test/types/negative/` fails with a specific TS error code. This is done without `@ts-expect-error`, because the codebase has no comments.

## `owned init` (`src/init/`)

| Module | Responsibility |
|---|---|
| `templates.ts` | Pure data: the generated project files and the four route templates (public, list, create, resource). |
| `agents-md.ts` | Renders `AGENTS.md` from `RULES`, `VALID_PATTERNS` and the route templates, so the instructions can't drift from what `owned check` enforces. |
| `write.ts` | Writes each file with flag `wx`. Existing files are skipped and never overwritten, so running `init` twice ends in the same state. |

The generated `owned.config.ts` authenticates from `x-user-id` and `x-user-role` only when `NODE_ENV=test`, and returns `null` otherwise. The safe default is that nobody is logged in until real authentication is written. The end-to-end test generates a project, adds every `AGENTS.md` template as a route, and requires `owned check` (including `tsc`) to report 0 errors and 0 warnings.
