# True Crew Analytics / Umami reference fork Execution Rules

These rules are mandatory for human and AI contributors.

## AI startup sequence

1. Read `AGENTS.md`.
2. Run `pnpm run ai:preflight` from the intended isolated worktree before mutation.
3. Read generated `.ai/runtime-context.md`.
4. Read `docs/ai/repo-context.md`.
5. Reconcile branch/HEAD/scope with the assigned task packet or explicit owner instruction.
6. Load applicable repository/reference governance, then inspect implementation/artifact files.

## Repository boundary

- Reference fork of Umami used for privacy-first analytics evaluation/self-hosting, not a True Crew product application.
- Owns: Only True Crew-specific fork/deployment/security overlay work explicitly authorized for the analytics service.
- Does not own: Customer-product application logic, CRM/customer truth, Command Center workflow state, or independent analytics product roadmap divergence from upstream.
- Do not expand or reclassify this repository beyond its recorded lifecycle without explicit approval.
- Generated runtime context is evidence only and never authorizes merge, deploy, provider writes, secrets, billing, destructive actions, or production changes.
