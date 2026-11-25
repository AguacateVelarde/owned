# Glossary

| Term | Meaning |
|---|---|
| **Contract** | What a route declares: `auth`, `input`, `output`, and for `user` routes `owner` (plus `load` on resource routes). `owned` enforces it at runtime and checks it statically. |
| **Auth level** | `public` (anyone), `user` (an authenticated user), `admin` (a user whose role is `admin`). |
| **Owner** | The name of the field that holds the id of the user a resource belongs to, e.g. `userId`. Compared against `ctx.user.id`. |
| **Route shape** | `resource`, `list` or `action`, decided by method and path. It determines how ownership is enforced. |
| **Resource route** | A route with a `:param`. `load` fetches the resource by params and `owned` compares its owner before the handler runs. |
| **List route** | A `GET` without a `:param`. `owned` filters the returned array to the caller's items. |
| **Action route** | A `POST`/`PUT`/`PATCH`/`DELETE` without a `:param`. `owned` verifies the returned resource belongs to the caller. |
| **load** | A function that receives only validated `params` and fetches the resource. It never sees `ctx`, so it cannot fabricate ownership. |
| **Open schema** | A schema that lets undeclared data through (`looseObject`, `passthrough`, `catchall`, `record`, `any`, `unknown`). Not allowed in input or output. |
| **Unsupported type** | A Zod type JSON Schema can't represent (e.g. `bigint`, a bare `transform`). Not allowed, because `owned` can't inspect it. |
| **Sensitive field** | An output field whose name looks like a secret (`password`, `hash`, `secret`, `token`, `apiKey`, `ssn`). |
| **unsafe** | The single escape hatch block. Each key needs a reason of at least 15 characters, every use is a warning, and the audit lists them all. |
| **Violation** | One rule failure: rule number and id, severity, file, message and the fix snippet. |
| **Fix** | Code the agent can paste to resolve a violation. Every violation has one. |
