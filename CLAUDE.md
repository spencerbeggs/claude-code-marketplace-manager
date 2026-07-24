# CLAUDE.md

## Project

`marketplace-manager` is a GitHub Action that edits a Claude Code plugin
**marketplace manifest** (`.claude-plugin/marketplace.json`) in place. It
partial-merge updates existing `git-subdir` plugin entries (any subset of
`url`/`path`/`sha`), validates the result (ajv structural + semantic), and lands
the change as a **verified** commit — directly on the base branch (`commit`
mode) or via a pull request (`pr` mode).

Precision by design: apply **only explicit values**. No release lookup or
ref→sha resolution.

## Stack

- Effect v4 (`4.0.0-beta.99`) + `@savvy-web/github-action-effects`.
- `@effected/jsonc` for format-preserving edits; `ajv` for manifest validation.
- Bundled to a committed `dist/` by `@savvy-web/github-action-builder`.
- Node ≥ 24.11; pnpm; Biome; Vitest.

## Commands

- `pnpm build` — bundle `src/` → `dist/` (run before committing action changes).
- `pnpm test` / `pnpm test:coverage` — Vitest.
- `pnpm typecheck` — `tsc --noEmit` via turbo.
- `pnpm lint` / `pnpm lint:fix` — Biome. `pnpm lint:md` — markdownlint.
- `pnpm generate-schema` — regenerate the committed root JSON Schemas.
- `pnpm validate` — validate `action.yml`.

## Conventions & gotchas

- **Never** stamp `botIdentity()` onto author/committer/signature fields —
  server-side signing is what makes commits verified. The bot identity feeds the
  DCO `Signed-off-by:` trailer (commit message text) only.
- Inputs are a manual/`json` **XOR**, enforced in `inputs.ts`; both normalize to
  `ParsedInputs.patches`.
- Validate the edited **result** before any commit; no-op guard skips validation
  and landing when the text is byte-stable.
- The installation token is always revoked in `post` — no opt-out.
- Effect Schemas are the source of truth; the root `*.input.json` /
  `*.output.json` schemas are generated and **drift-tested** — regenerate after
  schema changes, don't hand-edit.

## Design docs

Detailed architecture, rationale, and contracts live in
`.claude/design/marketplace-manager/`. Load the specific doc when working in that
area.

**For the module index & quick facts:**
→ `@./.claude/design/marketplace-manager/README.md`

Load first for orientation across the design docs.

**For system architecture:**
→ `@./.claude/design/marketplace-manager/architecture.md`

Load when working on the pre/main/post phases, `program.ts` orchestration,
module layout, layer composition, or the landing/mode split.

**For verified-commit rules:**
→ `@./.claude/design/marketplace-manager/verified-commits.md`

Load when touching commit landing, author/committer identity, or signing.

**For input/output contracts:**
→ `@./.claude/design/marketplace-manager/input-output-contracts.md`

Load when changing inputs, the patch shape, the JSON Schemas, or the `result`
output.

**For manifest validation:**
→ `@./.claude/design/marketplace-manager/validation.md`

Load when working on structural/semantic validation or the commit-time
invariant.
