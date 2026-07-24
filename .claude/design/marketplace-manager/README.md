---
status: current
module: marketplace-manager
category: architecture
created: 2026-07-23
updated: 2026-07-23
last-synced: 2026-07-23
completeness: 90
related:
  - ./architecture.md
  - ./verified-commits.md
  - ./input-output-contracts.md
  - ./validation.md
---

# marketplace-manager — design docs index

Design documentation for the `marketplace-manager` GitHub Action (`src/`), a
Claude Code plugin marketplace-manifest editor built on Effect v4 and
`@savvy-web/github-action-effects`.

## Documents

| Doc | Category | What it covers |
| ----- | ---------- | ---------------- |
| [architecture.md](./architecture.md) | architecture | System overview, pre/main/post phases, the `program.ts` orchestration pipeline, module layout, layer composition, and landing/mode split. Start here. |
| [verified-commits.md](./verified-commits.md) | security | The load-bearing decision: how server-side signing yields verified commits, and the rule to never stamp `botIdentity()` onto author/committer fields (DCO trailer only). |
| [input-output-contracts.md](./input-output-contracts.md) | architecture | The manual/`json` XOR input model, partial-merge patch shape, the three JSON Schema files + drift testing, and the structured `result` output. |
| [validation.md](./validation.md) | validation | Structural (ajv) + semantic manifest validation, the commit-time invariant, and the `strict: false` ajv rationale. |

## Quick facts

- **What it does:** partial-merge edits `git-subdir` plugin entries in
  `.claude-plugin/marketplace.json`, validates the result, and lands it as a
  verified commit (direct-to-base) or a PR.
- **Stack:** Effect `4.0.0-beta.101`, `@savvy-web/github-action-effects`,
  `@effected/jsonc`, `ajv`; bundled to `dist/` by
  `@savvy-web/github-action-builder`.
- **Precision by design:** explicit values only — no release/ref→sha resolution.
