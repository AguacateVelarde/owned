import { VALID_PATTERNS } from '../contract/route-file.ts'
import { MIN_REASON_LENGTH, RULES, UNSAFE_KEYS } from '../contract/rules.ts'
import type { RouteTemplate } from './templates.ts'

const FENCE = '```'

export function rulesTable(): string {
  const rows = Object.entries(RULES).map(([id, rule]) => `| ${rule.number} | \`${id}\` | ${rule.severity} | ${rule.title} |`)
  return ['| # | id | severity | rule |', '|---|---|---|---|', ...rows].join('\n')
}

function templateSection(template: RouteTemplate): string {
  return [`### ${template.title}`, '', `\`routes/${template.file}\``, '', `${FENCE}ts`, template.content.trimEnd(), FENCE].join('\n')
}

export function renderAgentsMd(templates: readonly RouteTemplate[]): string {
  return `# AGENTS.md

This project uses owned. Every route declares a contract (who can call it, what it takes, what it returns, and who owns the data) and owned enforces it. Follow these rules exactly.

## How to work

1. One file per route in \`routes/\`:
${VALID_PATTERNS.map((p) => `   - ${p}`).join('\n')}
2. After every change, run \`npx owned check --json\`.
3. Do not finish until it reports 0 errors and 0 warnings. Each violation comes with a \`fix\`: apply it.
4. Never add \`unsafe\` unless the human explicitly asked for that exception. Every use is a warning and shows up in the security audit.

## Code rules

- Import from owned only: \`import { defineRoute, z } from 'owned'\`. Never import zod directly.
- Relative imports end in \`.ts\`: \`import { getDb } from '../db.ts'\`.
- No \`enum\`, namespaces with values, or constructor parameter properties. Node runs this TypeScript by stripping types.
- Never connect to anything at the top level of a module. Use \`getDb()\` from \`db.ts\`. \`owned check\` imports every route.
- Output schemas list every field the client may see. owned removes everything else before responding.

## Auth

\`owned.config.ts\` turns a request into a user (\`{ id, role }\`) or \`null\`. In tests (\`NODE_ENV=test\`), send the \`x-user-id\` header, plus \`x-user-role: admin\` for admin routes. Replace the production branch with real session or token verification before deploying.

## Route shapes

The shape comes from the method and the path:
- a \`:param\` in the path makes a **resource** route;
- \`GET\` without a param is a **list** route;
- any other method without a param is a **create/action** route.

${templates.map(templateSection).join('\n\n')}

## Rules enforced by \`owned check\`

${rulesTable()}

\`unsafe\` keys: ${UNSAFE_KEYS.map((k) => `\`${k}\``).join(', ')}. Each needs a reason of at least ${MIN_REASON_LENGTH} characters.
`
}
