# Contributing

Thank you for considering contributing to `claude-code-marketplace-manager`.
This document explains how to set up your environment and submit changes.

## Prerequisites

- **Node.js** `>=24.11.0` (see `engines` in `package.json`)
- **pnpm** `11.16.0` (enforced via the `packageManager` field)
- **Git** with commit signing configured (recommended)

## Setup

```bash
git clone https://github.com/spencerbeggs/claude-code-marketplace-manager.git
cd claude-code-marketplace-manager
pnpm install
```

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm build` | Bundle `src/` into the committed `dist/` via Turbo + `github-action-builder` |
| `pnpm ci:build` | Same as `build`, run in CI mode with full log output |
| `pnpm test` | Run the Vitest suite (no coverage) |
| `pnpm test:coverage` | Run the Vitest suite with coverage enabled |
| `pnpm ci:test` | Run the Vitest suite with coverage, `CI=true` |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Run Biome checks (no auto-fix) |
| `pnpm lint:fix` | Run Biome with auto-fix (safe fixes only) |
| `pnpm lint:fix:unsafe` | Run Biome with auto-fix, including unsafe fixes |
| `pnpm lint:md` | Lint markdown files with `markdownlint-cli2` |
| `pnpm lint:md:fix` | Auto-fix markdown lint issues |
| `pnpm typecheck` | Type-check the workspace via Turbo (`tsc --noEmit`) |
| `pnpm generate-schema` | Regenerate the committed root `*.input.json` / `*.output.json` JSON Schemas from the Effect Schemas |
| `pnpm validate` | Validate `action.yml` via `github-action-builder validate` |

Run `pnpm build` before committing any change under `src/` — `dist/` is
committed and must stay in sync with the source.

If a change touches an Effect Schema that backs an input/output contract, run
`pnpm generate-schema` afterward; the root schemas are drift-tested and must
not be hand-edited.

## Code Quality Standards

- **Formatter/Linter:** Biome `2.5.1`, extending `@savvy-web/silk/biome`
- **TypeScript:** `7.0.2`, strict mode, extending
  `@savvy-web/github-action-builder/tsconfig/action.json`
- **Effect:** `4.0.0-beta.99` — follow the project's Effect v4 idioms
  (services/layers, Schema-first contracts)
- **Testing:** Vitest via the `@vitest-agent/plugin` (`~2.0.6`) preset; tests
  live under `__test__/`, mirroring the `src/` layout, as `*.test.ts` files
- **Imports:** Use `.js` extensions in relative imports; use the `node:`
  protocol for Node.js built-ins; keep type-only imports separate

## Pre-commit Hooks

The repository uses Husky with `savvy`-managed hook sections. When you
commit:

- `pre-commit` runs `lint-staged` (configured in
  `lib/configs/lint-staged.config.ts`, via the `@savvy-web/silk` preset) —
  TypeScript/JavaScript files are checked and fixed with Biome, and other
  staged files are formatted per the preset
- `commit-msg` runs `commitlint` (configured in
  `lib/configs/commitlint.config.ts`) to enforce Conventional Commits
- `post-checkout` / `post-commit` / `post-merge` re-sync file-mode bits for
  shell scripts

## Contribution Process

1. **Branch** — create a feature branch from `main`
2. **Make changes** — follow the code quality standards above; run
   `pnpm build` if `src/` changed, and `pnpm generate-schema` if a schema
   changed
3. **Test** — run `pnpm test` (or `pnpm ci:test` for coverage) and ensure all
   tests pass
4. **Lint & typecheck** — run `pnpm lint:fix` and `pnpm typecheck`
5. **Add a changeset** — describe your change for the changelog (see
   `.changeset/config.json`)
6. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/)
   format (enforced by commitlint); sign off per the DCO requirement below
7. **Submit a PR** — PR titles must also follow Conventional Commits format

## Developer Certificate of Origin (DCO)

All commits must be signed off to certify that you have the right to submit
the contribution under the project's license. Add `Signed-off-by` to your
commits:

```bash
git commit -s -m "feat: add new feature"
```

## License

By contributing, you agree that your contributions will be licensed under
the MIT License.
