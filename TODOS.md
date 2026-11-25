# TODOS

## Positioning: README and landing page against the agent defaults

- **What:** A README and a landing page that position `owned` against what coding agents pick by default (Next.js server actions, Supabase), not against Express. Include a copy-paste prompt such as "use owned for the backend".
- **Why:** The vibecoder doesn't pick the framework, the agent does. If the human never tells the agent to use `owned`, nobody adopts it. `owned init` + `AGENTS.md` is the real product.
- **Pros:** Gives the docs a direction from day 1.
- **Cons:** Not code. Doesn't block v1.
- **Context:** Came from finding #10 of the outside voice in `/plan-eng-review` (2026-11-24). Start with the README: problem → 30-second demo of `owned audit` → prompt for the agent.
- **Depends on:** Nothing. Works better once there's real `owned audit` output to show.

## v2: `owned attack`

- **What:** A command that creates two synthetic users (A and B) and tries every route as A against B's resources, every `admin` route as an anonymous caller, and checks responses for undeclared fields. Can run as a diff in PRs ("this change made DELETE /orders/:id public").
- **Why:** The audit reads contracts. The attack tests them at runtime. It is the verification that closes the "the agent can't verify its own work" pain.
- **Pros:** The most "whoa" version of the product. Reuses the E2E and eval harness.
- **Cons:** Complex: each app needs its own data fixtures (creating resources for A and B).
- **Context:** Proposed by the second opinion in `/office-hours` and deferred to v2. Design doc: `~/.gstack/projects/AguacateVelarde-exploit-nodejs/leo-main-design-20261124-201908.md`.
- **Depends on:** All of v1, especially the test `authenticate` (`x-user-id` header) from `owned init`.
