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
