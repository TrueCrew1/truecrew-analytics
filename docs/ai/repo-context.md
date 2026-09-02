# Repository AI Context — True Crew Analytics / Umami reference fork

Status: repository-local AI context. Engineer-standard remains the cross-repository engineering authority.

## Repository identity

- Repository: `TrueCrew1/truecrew-analytics`
- Product/role: Reference fork of Umami used for privacy-first analytics evaluation/self-hosting, not a True Crew product application.
- Lifecycle: reference fork
- Canonical True Crew agent runtime: Node `24.19.0`

## Ownership

**Owns:** Only True Crew-specific fork/deployment/security overlay work explicitly authorized for the analytics service.

**Does not own:** Customer-product application logic, CRM/customer truth, Command Center workflow state, or independent analytics product roadmap divergence from upstream.

## Data/runtime boundary

Upstream Umami owns its application database model. Do not turn this reference fork into shared customer-product database authority.

## Deployment boundary

Treat as an upstream/reference analytics service. Runtime/provider/deployment activation remains separately governed and should minimize fork divergence.

## AI execution contract

1. Run `pnpm run ai:preflight` from the intended isolated worktree before material mutation.
2. Treat `BLOCKED` as a stop condition. Never reset/stash/clean/rebase/discard unexpected state to make the preflight pass.
3. When a packet supplies branch/base expectations, set `TRUECREW_EXPECTED_BRANCH`, `TRUECREW_EXPECTED_HEAD`, and `TRUECREW_TASK_PACKET`.
4. `--allow-dirty` and `--allow-production-branch` are read-only/recovery snapshot controls only.
5. Reference/experimental lifecycle is a real constraint: do not expand a reference or experiment into a product/runtime without explicit portfolio reclassification.
6. Baseline validation: Use upstream-compatible checks required by the changed surface; do not represent an upstream/reference read as True Crew production health.

## Durable documents to load when applicable

- `README.md`

## Cross-system rule

Provider and customer-product records remain owned by their source systems. Reference code never gains True Crew production authority merely because it is stored in a True Crew repository.
