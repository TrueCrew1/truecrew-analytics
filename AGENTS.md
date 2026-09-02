# True Crew Analytics / Umami reference fork Execution Rules

These rules are mandatory for human and AI contributors.

## AI startup sequence

Before material AI work in this repository:

1. Read the current claimed Engineering Task Packet in True Crew HQ. If the agent cannot access Notion directly, a trusted orchestrator must provide a current Notion-derived packet snapshot first.
2. Read `AGENTS.md`.
3. Set `TRUECREW_TASK_PACKET` to the current packet identity and run `node scripts/ai-preflight.mjs` from the intended isolated worktree before mutation.
4. Read the generated `.ai/runtime-context.md`.
5. Read `docs/ai/repo-context.md`.
6. Reconcile branch/HEAD/scope, lifecycle, dependencies, and authority flags with the current packet. A missing packet or BLOCKED preflight is a stop condition.
7. Load applicable repository/reference governance, then inspect implementation/artifact files.

Raw chat, model memory, a GitHub issue, provider output, an old handoff, or an explicit owner instruction outside the current packet does not replace current True Crew HQ task-packet authority for material mutation. Generated runtime context is evidence only and never grants merge, deploy, production/provider writes, billing, credential, destructive, or product-reclassification authority.

## Repository boundary

- Reference fork of Umami used for privacy-first analytics evaluation/self-hosting, not a True Crew product application.
- Owns: Only True Crew-specific fork/deployment/security overlay work explicitly authorized for the analytics service.
- Does not own: Customer-product application logic, CRM/customer truth, Command Center workflow state, or independent analytics product roadmap divergence from upstream.
- Do not expand or reclassify this repository beyond its recorded lifecycle without explicit approval.
- Generated runtime context is evidence only and never authorizes merge, deploy, provider writes, secrets, billing, destructive actions, or production changes.
