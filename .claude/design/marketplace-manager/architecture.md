---
status: current
module: marketplace-manager
category: architecture
created: 2026-07-23
updated: 2026-07-24
last-synced: 2026-07-24
completeness: 92
related:
  - ./verified-commits.md
  - ./input-output-contracts.md
  - ./validation.md
dependencies:
  - "@savvy-web/github-action-effects"
  - "@savvy-web/github-action-builder"
  - "@effected/jsonc"
  - effect@4.0.0-beta.99
---

# marketplace-manager — architecture

## Overview

`marketplace-manager` is a GitHub Action that edits a Claude Code plugin
**marketplace manifest** (`.claude-plugin/marketplace.json`) in place. It applies
partial-merge updates to existing `git-subdir` plugin entries (any subset of
`url` / `path` / `sha`), validates the result (structural + semantic), and lands
the change as a **verified** commit — either directly on the base branch
(`commit` mode) or via a pull request (`pr` mode).

It is built on Effect v4 (`4.0.0-beta.99`) and `@savvy-web/github-action-effects`,
bundled into a committed `dist/` by `@savvy-web/github-action-builder`.

### Why it exists

It replaces a hand-written workflow + bash script (`repin-plugins.sh`) that had
two defects:

1. **Unverified commits.** A git-CLI push authenticated with a GitHub App token
   is *not* GPG-verified, so "require signed commits" branch protection rejected
   it. See [verified-commits.md](./verified-commits.md).
2. **Imprecision / noise.** Auto-resolving each plugin's "latest release" could
   move a plugin onto an untested commit and re-pin unchanged plugins, forcing
   Claude Code to re-download them.

This action applies **only explicit values** (precision by design) and produces
**server-signed (verified)** commits.

## Three-phase action shape

The action runs as the standard pre / main / post lifecycle:

| Phase | File | Responsibility |
| ------- | ------ | ---------------- |
| pre | `src/pre.ts` | Provision a GitHub App installation token with `REQUIRED_PERMISSIONS = { contents: "write", pull_requests: "write" }`; record start time into cross-phase state. |
| main | `src/main.ts` | Thin `Action.run(program, { layer: MainLive })`. All work lives in `program.ts`. |
| post | `src/post.ts` | **Revoke-first**: always dispose the installation token (belt-and-braces `catch`/`catchDefect`), on success and failure alike. |

The installation token is **always** revoked in `post`; there is no opt-out.

## Orchestration (`src/program.ts`)

`program` wraps `parseInputs` and the orchestration body (`runOrchestration`)
in `Effect.exit`. On a typed failure at either stage it emits a structured
failed `result` (`status: "failed"`, `hasFailures: true`, `succeeded: false`,
`changed: "false"`) via an `emitFailure` helper, then re-raises with
`Effect.failCause` so the action still exits non-zero. Every terminal path —
no-op, dry-run, land, and failure — emits a `result` before returning. See
[input-output-contracts.md](./input-output-contracts.md).

The full logical pipeline, in order (step 1 in `program`, steps 2–9 in
`runOrchestration`):

1. **Parse inputs** (`parseInputs`) → a normalized `ParsedInputs` with a
   `patches` array. Enforces the manual/`json` XOR. See
   [input-output-contracts.md](./input-output-contracts.md).
2. **Read manifest** (`ManifestEditor.readManifest`) from the checkout.
3. **Apply patches** (`ManifestEditor.applyPatches`) — format-preserving
   partial-merge via `@effected/jsonc`, matched by plugin name. An unknown name
   fails with `PluginNotFoundError`.
4. **No-op guard.** If the edited text equals the original (`!edit.changed`),
   emit a `noop` result and stop — no validation, no commit.
5. **Validate the RESULT** (`ManifestValidator.validateManifest`) — ajv
   structural + semantic checks *before any commit*. See
   [validation.md](./validation.md).
6. **Dry-run guard.** If `dryRun`, emit the summary/output and stop before
   landing. Dry-run never reads the token identity, so no provisioned token is
   required on that path.
7. **Build default messages.** `GitHubToken.botIdentity()` feeds the DCO trailer
   only; the `ai(marketplace): …` subject/body come from the change set.
8. **Land** (`ManifestCommitter.land`) per `mode` (commit or PR).
9. **Emit** the structured `result` output, convenience scalars, and a job
   summary (both non-fatal).

## Module layout (`src/`)

| Area | Files | Role |
| ------ | ------- | ------ |
| Lifecycle | `pre.ts`, `main.ts`, `post.ts` | Phase entrypoints. |
| Orchestration | `program.ts` | The main pipeline (above). |
| Inputs | `inputs.ts` | `parseInputs` → `ParsedInputs`; enforces the XOR. |
| Errors | `errors/errors.ts` | Tagged errors: `InvalidInputError`, `ManifestValidationError`, `PluginNotFoundError`. |
| Schema | `schema/marketplace.ts`, `schema/input.ts`, `schema/report-output.ts`, `schema/projections.ts` | Effect Schemas (source of truth) + committed JSON Schema sources + the pure output projection. |
| Services | `services/ManifestEditor.ts`, `services/ManifestValidator.ts`, `services/ManifestCommitter.ts` | Read/edit, validate, and land. |
| Report | `report.ts` | Pure default-message + job-summary builders. |
| Wiring | `layers/app.ts`, `state.ts` | `PreLive`/`MainLive`/`PostLive` layers; cross-phase start-time state. |

## Layer composition (`src/layers/app.ts`)

- `PreLive` / `PostLive` — `GitHubAppLive ∘ OctokitAuthAppLive ∘
  FetchHttpClient.layer` merged with `NodeFileSystem.layer` (provision/dispose +
  filesystem for `ActionState`).
- `MainLive` — the installation token provisioned in pre is read back via
  `GitHubToken.client()` (`Layer.orDie` — a missing token is a wiring defect).
  The git services `GitCommitLive` / `GitBranchLive` / `PullRequestLive` are each
  built from that client; `PullRequestLive` additionally needs `GitHubGraphQL`,
  built from the same client and merged in. `NodeServices.layer` provides
  `FileSystem` (manifest read) and backs `ActionState`.

## Landing (`services/ManifestCommitter.ts`)

`land(params)` owns the mode split. It never passes author/committer/signature,
which is what keeps commits verified:

- **commit mode:** `commit.commitFiles(base, message, [file])` directly on the
  base branch (`commitFiles` reads the base head as parent itself).
- **pr mode:** `branch.exists` → (if absent) `branch.getSha(base)` +
  `branch.create(branch, baseSha)` → `commit.commitFiles(branch, …)` →
  `pulls.getOrCreate({ head, base, title, body, autoMerge })` (reuses/updates an
  existing PR for the same head). `autoMerge` (`merge`|`squash`|`rebase`, input
  default `rebase`) is applied on both the create and the update path — the
  library's `PullRequestLive` calls GitHub's `enablePullRequestAutoMerge`
  GraphQL mutation via `Effect.tap` after either — so re-running the action
  against an already-open PR re-applies the current method. `commit` mode never
  reaches this branch, which is how the input has "no effect unless mode is pr".

`resolveBaseBranch(input)` returns the explicit `base-branch` input when set,
otherwise resolves the repo's `default_branch` via `client.rest("repos.get")`.

## Error taxonomy

Three action-domain tagged errors (`errors/errors.ts`). Library errors
(`GitCommitError`, `GitBranchError`, `PullRequestError`, `GitHubClientError`) are
matched by `_tag`, never wrapped. `Action.run` owns the exit code; misconfig dies
at the layer boundary via `Layer.orDie`; summary/comment writes demote to
`logWarning`.

## Scope

**In scope (v1):** editing existing `git-subdir` entries; manual + `json` input
paths; partial-merge field updates; result validation; commit-direct or PR;
verified commits; structured JSON output + markdown job summary.

**Out of scope (v1), deliberately:** GitHub release lookup / ref→sha resolution
(explicit values only); adding new plugins or non-`git-subdir` sources (unknown
name is an error); editing manifest `metadata`/`owner`/top-level fields.

## Notes / drift watch

- The design spec mentions an *optional* sticky PR comment in `pr` mode; the
  current `program.ts` emits the job summary but does **not** post a PR comment.
  Treat the sticky comment as unimplemented until code lands.
- Schema generation (`generate-schema.ts` + drift test) lives in the build/lib
  tooling; the committed input/output schemas are drift-tested. See
  [input-output-contracts.md](./input-output-contracts.md).
