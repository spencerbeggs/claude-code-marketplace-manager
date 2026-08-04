---
status: current
module: marketplace-manager
category: architecture
created: 2026-07-23
updated: 2026-08-04
last-synced: 2026-08-04
completeness: 92
related:
  - ./verified-commits.md
  - ./input-output-contracts.md
  - ./validation.md
dependencies:
  - "@effected/github-actions"
  - "@effected/github"
  - "@savvy-web/github-action-builder"
  - "@effected/jsonc"
  - effect@4.0.0-beta.101
---

# marketplace-manager — architecture

## Overview

`marketplace-manager` is a GitHub Action that edits a Claude Code plugin
**marketplace manifest** (`.claude-plugin/marketplace.json`) in place. It applies
partial-merge updates to existing `git-subdir` plugin entries (any subset of
`url` / `path` / `sha`), validates the result (structural + semantic), and lands
the change as a **verified** commit — either directly on the base branch
(`commit` mode) or via a pull request (`pr` mode).

It is built on Effect v4 (`4.0.0-beta.101`), `@effected/github-actions` (the
runner) and `@effected/github` (the API),
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

Two details of the `pre` call are easy to misread:

- **`REQUIRED_PERMISSIONS` is passed as `required`, and it verifies rather than
  requests.** The pre-port option was spelled `permissions` and was *also*
  verify-only — the rename carries no capability change. The granted permissions
  travel back with the minted token, so the check is pure and runs *before* the
  token is persisted: a misconfigured installation fails in `pre` naming the
  missing permission, instead of failing mid-`main` on a bare 403.
- **The App credentials are explicit arguments.** `GitHubToken.provision` now
  takes `appId` / `privateKey`; the pre-port helper defaulted them internally
  from the `app-client-id` / `app-private-key` inputs. `pre.ts` reads both, and
  the private key is read with `ActionInput.redacted` and stays `Redacted` end to
  end — `provision` takes the wrapper, so it is never unwrapped in this module.

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
   emit a `noop` result and stop — no validation, no commit. `EditResult` is a
   union discriminated on `changed`, so this guard is also what narrows the edit
   to the `ChangedEdit` that step 5 requires.
5. **Validate the RESULT** (`ManifestValidator.validateEdit`) — ajv structural +
   semantic checks *before any commit*, returning the branded
   `ValidatedManifestChange` that `land` requires. See
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

- `PreLive` / `PostLive` — **one layer, not two**: `PreLive = GitHubApp.layer`
  and `PostLive = PreLive`. `GitHubApp.layer` requires nothing (it signs the app
  JWT itself), and `ActionRuntime.layer` — which `Action.run` always composes —
  already provides `FileSystem`, `HttpClient`, `ActionState` and
  `ActionOutputs`. Everything the pre-port composition stacked underneath is
  therefore gone from `layers/app.ts`: `NodeServices`, `NodeFileSystem`,
  `FetchHttpClient`, `ActionStateLive`, `GitHubGraphQLLive`, and the
  `GitHubAppLive ∘ OctokitAuthAppLive` pair.
- `MainLive` — the installation token provisioned in pre is read back via
  `GitHubToken.clientLayer()` (`Layer.orDie` — a missing or expired token is a
  wiring defect, and `ActionRunOptions.layer` requires a `never` error channel).
  It is bound to a `const`, because a parameterized layer factory mints a fresh
  layer per call and layers memoize **by reference**. `GitCommit.layer`,
  `GitBranch.layer`, `PullRequest.layer` and `GitHubRepository.layer` are each
  built from that one client, merged with `Repo.layerFromConfig()`. No separate
  GraphQL layer is needed — auto-merge is a `PullRequest` member now.

  **`Repo` is resolved per call, not captured at layer construction:** every
  resource method carries `Repo` in its requirements, which is what would make a
  scoped `Repo.provide` override work rather than silently do nothing.

## Landing (`services/ManifestCommitter.ts`)

`land(params)` owns the mode split. It never passes author/committer/signature,
which is what keeps commits verified:

- **commit mode:** `commit.commitFiles({ branch: base, message, changes })`
  directly on the base branch (`commitFiles` reads the base head as parent
  itself). `changes` carries a `FileContent` instance, not a bare
  `{ path, content }` literal.
- **pr mode — the commit is built before the ref moves:**
  `branch.sha(base)` → `commit.get(baseSha)` →
  `commit.createTree({ changes, baseTree })` →
  `commit.createCommit({ message, tree, parents: [baseSha] })` →
  **`branch.upsert(head, sha)` once, straight to the finished commit** →
  `pulls.upsert({ title, head, base, body })` →
  `pulls.setAutoMerge(pr, autoMerge)`.

  `upsert` subsumes the pre-port `exists` / `create` / re-check-on-failure
  recovery: `GitHubError`'s `kind: "alreadyExists"` is structural, so a
  concurrent creator is recognized by the error's shape rather than by matching
  its prose, and the recovery resets rather than inheriting a branch rooted
  elsewhere.

  `setAutoMerge` is a **separate call**, not an option on `upsert`. The pre-port
  surface fired it from an `Effect.tap` after the create, so an auto-merge
  failure could surface as though opening the PR had failed. `commit` mode never
  reaches any of this, which is how the input has "no effect unless mode is pr".

### The pr-mode branch is force-synced onto base every run

`land` roots the head branch at base's **current** tip on every `pr`-mode run,
discarding any commits an earlier run left there. The `branch` input defaults to
a fixed name (`chore/repin-plugins`) reused run over run, so without this the
branch accumulates commits against ever-staler bases until the PR is unmergeable
(observed: `spencerbeggs/bot` PR #12, `mergeable: "CONFLICTING"`).

The reset is unconditional rather than gated on detecting an open PR: a stale
branch whose PR was already closed is precisely the case that most needs
re-rooting. `branch.sha(base)` is therefore read on every `pr`-mode run.

#### Decision D-2 — the re-rooting and the commit are a single ref move

The pre-port sequence was `reset(head, baseSha)` **then** `commitFiles(head)`.
That is wrong, and `@effected/github` documents it as a live defect against
`GitBranch.upsert` (`.repos/effected/packages/github/src/GitBranch.ts:46-69`;
its `CLAUDE.md` carries the same rule as a "Never"): between the two calls the
head branch *is* base, so an open PR from it has an empty diff and **GitHub
auto-closes it**. A consumer lost its release PR to that ~3-second window while
the run reported success. The same TSDoc names *this* action as the consumer
whose four-round-trip `getSha` → `exists` → `create` → re-`exists` → `reset`
dance the `upsert` API was built to replace.

So `land` builds the tree and commit against base first and calls `upsert`
**once**, straight to the finished sha; the ref never rests on the bare base
head. The current sequence is:

```text
branch.sha(base) → commit.get(baseSha) → commit.createTree({changes, baseTree})
  → commit.createCommit({parents: [baseSha]}) → branch.upsert(head, sha)  ← once
  → pulls.upsert → pulls.setAutoMerge
```

**This was a user ruling, not an implementer's choice.** The port was otherwise
run under a strict parity contract; D-2 is a deliberate, explicitly-sanctioned
deviation from pre-port behavior, adopted because the pre-port ordering was
itself the defect. Do not "restore parity" here.

The end state is identical to the pre-port behavior — head branch rooted at
base's current tip, carrying exactly one commit — so the *invariant* is
unchanged and only the call ordering differs. Two tests pin it directly (`B5:`
in `__test__/services/ManifestCommitter.test.ts`), because under a single
`upsert` the reset is implicit and is exactly the kind of invariant that quietly
loses its coverage in a refactor.

Consequences worth knowing:

- A human commit pushed onto the `pr`-mode head branch **is discarded**. That
  branch is action-owned by design; no input guards it.
- The reset can never produce an empty diff, because `land` is only reached once
  the no-op guard has proven the edit differs from base. No PR close/reopen
  handling is needed.
- **Assumption: the checkout is `base`.** The committed text is read from the
  local checkout, so pointing `base-branch` at a ref other than the checked-out
  one produces a tree derived from the wrong ref. Pre-existing hazard, not
  addressed here.

`resolveBaseBranch(input)` returns the explicit `base-branch` input when set,
otherwise resolves the repo's default branch via `GitHubRepository.defaultBranch`.
That member replaced a `client.rest<{ default_branch }>("repos.get", …)` callback
and the hand-written `ReposGetOctokit` interface it had to be cast into — the
route is the kit's concern now, so there is nothing left to cast.

## Error taxonomy

Three action-domain tagged errors (`errors/errors.ts`): `InvalidInputError`,
`PluginNotFoundError`, `ManifestValidationError`.

Library failures collapsed at the port: the four pre-port types
(`GitCommitError`, `GitBranchError`, `PullRequestError`, `GitHubClientError`)
are now the single **`GitHubError`**, which carries a structured `kind`
(e.g. `"alreadyExists"`, `"notFound"`) so call sites discriminate on shape
rather than on error prose. The one exception is the GraphQL-backed auto-merge
path, which adds `GitHubGraphQLError` — hence `land`'s error channel is
`GitHubError | GitHubGraphQLError | InvalidInputError` while
`resolveBaseBranch`'s is just `GitHubError`. Library errors are still matched,
never wrapped.

`land`'s `InvalidInputError` is the one failure it raises itself: **`pr` mode
refuses a head branch equal to its base.** `branch` and `base` are independent
inputs — the latter resolved from `base-branch` or the repo default — so
nothing structural prevents them colliding. If they did, the single
`GitBranch.upsert` would move the *base* branch to the new commit, landing an
unreviewed commit directly on it, and `PullRequest.upsert` would only fail
afterwards on a head equal to its base: the failure would arrive after the
write it exists to prevent. The guard runs before the commit is built, and
lives in `land` rather than at the `program.ts` call site because it protects
the write, not the caller. Commit mode is deliberately unaffected — it writes
to `base` by design and never reads `branch`.

`Action.run` owns the exit code; misconfig dies at the layer boundary via
`Layer.orDie`; summary/comment writes demote to `logWarning`.

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
