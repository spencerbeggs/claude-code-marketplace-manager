---
status: current
module: marketplace-manager
category: architecture
created: 2026-07-23
updated: 2026-09-06
last-synced: 2026-09-06
completeness: 93
related:
  - ./architecture.md
  - ./validation.md
dependencies:
  - effect@4.0.0-rc.112
---

# marketplace-manager — input & output contracts

## Effect Schema is the single source of truth

The action's own Effect Schemas define both the input and output contracts. The
build **generates and commits** two SchemaStore-shaped JSON Schema files at the
repo root, each **drift-tested** against its Effect Schema source; a third schema
is a vendored asset:

| File (repo root) | Origin | Use |
| ------ | -------- | ----- |
| `claude-code-marketplace-manager.input.json` | generated from the `json` input Effect Schema (`schema/input.ts`) | contract a caller/LLM validates its `json` payload against |
| `claude-code-marketplace-manager.output.json` | generated from the `result` output Effect Schema (`schema/report-output.ts`) | consumers validate the action's `result` output |
| `src/schema/claude-code-marketplace.json` | vendored SchemaStore asset (bundled) | ajv validation of the resulting manifest — see [validation.md](./validation.md) |

Generation is driven by `lib/scripts/generate-schema.ts` with a
`{ schema, $id, path }` target table and guarded by a drift test. Both root
schema files are present and drift-tested as of this branch.

The script exports **both** `targets` and its `AppLayer`, and
`__test__/generate-schema.test.ts` imports both, so the drift check runs the
generator's own walk against the generator's own wiring rather than a
re-declared copy that can drift out of step with it. `SchemaPipeline.checkOne`
*reports* rather than enforces, so the test asserts its three signals
separately — they are not redundant, because each has a different remedy:

| Signal | Meaning | Remedy |
| -------- | --------- | -------- |
| `blocked` | the document could never have been written at all | fix the findings; regenerating will not help |
| `contractBlocked` | the contract policy would refuse the write | bump the schema version |
| `wouldWrite` | ordinary drift | run `pnpm generate-schema` |

`DocumentDiff.isClean(result.change)` is asserted alongside them, comparing
content rather than text so the guard is immune to whatever formatted the
committed file.

## `src/contract.ts` — the middle term between `action.yml` and the code

`action.yml` is the manifest GitHub reads, but **nothing in the type system
connects it to the code that reads those inputs and writes those outputs.** The
two drift silently, and in the direction that hurts most: rename an input in
`action.yml` without updating the `ActionInput` call and you have a perfectly
type-correct action that reads an input nobody supplies and quietly takes the
default. There is no compile error and no runtime error — just wrong behavior.

`src/contract.ts` is the middle term that makes the mismatch checkable. It is
deliberately dependency-free — a description of the contract, not a participant
in it — and exports:

- `INPUT_NAMES` (15) and `OUTPUT_NAMES` (9), the declared names, ordered to
  match the manifest for reviewability (the test compares as sets).
- `InputName` / `OutputName`, those tuples narrowed to types.
- `INPUT_DEFAULTS` — **only** the inputs whose `action.yml` default is something
  other than `""`: `mode`, `branch`, `auto-merge`, `dry-run`. An omitted input
  arrives as `""` whether or not the manifest says so, and `inputs.ts` maps `""`
  to "missing" uniformly, so an empty default carries no information. A
  *non-empty* default is a real behavioral decision that previously existed
  twice — once in the manifest, once as a literal in `inputs.ts` — with nothing
  keeping the two honest. `inputs.ts` now reads them from here.

`__test__/action-contract.test.ts` asserts a **three-way** agreement:

1. `action.yml` ↔ `contract.ts` — the declared name sets match exactly, the
   mirrored defaults match, and every *other* optional input still defaults to
   `""` (which is the reasoning `INPUT_DEFAULTS` is built on: an unmirrored
   input quietly acquiring a real default would change behavior with nothing to
   notice it).
2. `contract.ts` ↔ the code — every declared name appears in an
   `ActionInput.<accessor>("name")` read or an `outputs.set*("name", …)` write
   somewhere in `inputs.ts` / `pre.ts` / `program.ts`. This leg is asserted
   against the **source text**, because a name reaching those calls is a string
   literal that appears in no type — there is nothing else for a test to hold.

`action.yml` is parsed with `@effected/yaml` (a test-only devDependency) and
decoded through a `Schema.Record` that models only `inputs` and `outputs`, so
the manifest stays free to carry keys (`branding`, `runs`) without the decode
becoming a second place to maintain the contract.

`dry-run` is spelled in `INPUT_DEFAULTS` as the manifest's string `"false"`;
`inputs.ts` reads it through `ActionInput.boolean` and the test asserts the two
agree once parsed.

**Adding or renaming an input or output means editing all three places** —
`action.yml`, `contract.ts`, and the call site — or the suite fails.

## Input contract (`action.yml` → `inputs.ts`)

### The manual/`json` XOR

Inputs are an exclusive choice, enforced in `inputs.ts` and failing with
`InvalidInputError` before any work:

- **manual path:** `name` **plus at least one** of `url` / `path` / `sha`.
- **`json` path:** a JSON object with a `plugins` array of per-plugin partial-merge patches.
- Never both, never neither. `name` alone with no field is invalid.

Both paths normalize into the same `ParsedInputs.patches: ReadonlyArray<PluginPatch>`;
the manual path is simply the one-element case (`decoded.plugins` for the `json`
path in `inputs.ts`).

### `json` shape — a `plugins` envelope of partial-merge patches

```jsonc
{
  "plugins": [
    { "name": "vitest-agent", "sha": "8cba76025762cfa1dca24e6daafe2e3dc7c14924" },
    { "name": "effected", "path": "plugin", "sha": "9dbea50a1de276d4ab349e6be445e2e1f433a7ae" }
  ]
}
```

`JsonInput` (`schema/input.ts`) is deliberately an object root
(`Schema.Struct({ plugins: Schema.Array(PluginPatch) })`), not a bare array —
changed from a bare-array shape to a `plugins`-keyed envelope for two reasons:
the generated schema is usable as-is by tool-calling / structured-output
validators that require an object at the schema root, and the key name mirrors
`marketplace.json`'s own top-level `plugins` array, leaving room for sibling
keys (e.g. a future manifest-level option) without another shape-breaking
change. A bare-array `json` payload (the original shape) now fails decode with
`InvalidInputError`.

Each entry is matched to a plugin by `name`; only the provided fields
(`url`/`path`/`sha`) change, everything else is left byte-stable. This was chosen
over full-manifest replacement (drops metadata/other plugins) and RFC 7386
merge-patch (opaque array semantics, harder to validate).

**Explicit values only** — there is no release lookup or "latest" sentinel.

### Other inputs

The non-empty defaults below are not re-declared in `inputs.ts`; it reads them
from `INPUT_DEFAULTS` (above), which the contract test holds equal to
`action.yml`.

| Input | Default | Purpose |
| ------- | --------- | --------- |
| `mode` | `commit` | `commit` (direct to base) or `pr`. |
| `base-branch` | repo default branch | Branch committed to / PR base. `null` ⇒ resolved at runtime via `GitHubRepository.defaultBranch`. |
| `branch` | `chore/repin-plugins` | PR head branch (pr mode). |
| `commit-message` / `pr-title` / `pr-body` | generated (§ default messages) | Overrides. Empty string ⇒ `null` ⇒ use generated default. |
| `auto-merge` | `rebase` | `merge`\|`squash`\|`rebase`, validated in `inputs.ts` (invalid value ⇒ `InvalidInputError`). Threaded into `ManifestCommitter.land`'s `pr`-mode branch and applied with an explicit `PullRequest.setAutoMerge(pr, method)` call after the PR is upserted, which enables GitHub's native auto-merge via the `enablePullRequestAutoMerge` GraphQL mutation. It is a separate call rather than an option on the upsert, so an auto-merge failure is never reported as though opening the PR had failed. Read but unused in `commit` mode — there is no PR to enable it on. |
| `dry-run` | `false` | Validate + emit output, skip commit/PR. |
| `app-client-id` / `app-private-key` | — (required) | GitHub App credentials, read in `pre.ts` and passed **explicitly** to `GitHubToken.provision` (the pre-port helper defaulted them from these inputs internally). The private key is read with `ActionInput.redacted` and stays `Redacted` end to end. |

## Output contract (`schema/report-output.ts` + `projections.ts`)

The structured `result` output (`ReportOutput`) is built by the **pure**
`toReportOutput` projection and emitted via `outputs.setJson("result", …)`. Its
shape:

- `$schema` — hosted URL (`…/main/claude-code-marketplace-manager.output.json`),
  emitted first.
- `schemaVersion` — in-band `"1"`; bumped only on a breaking shape change.
- **Orthogonal booleans** consumers branch on: `noop`, `succeeded`,
  `hasFailures`, plus `dryRun`.
- `mode` (`commit`|`pr`) and derived human `status` (`no-op`|`success`|`failed`).
- Payload last: `pluginsUpdated` (count), `plugins` (`{name, fields[]}`),
  `commit` (`{sha, url}` | null), `pr` (`{number, url}` | null).

Status derivation (`deriveStatus`) checks `succeeded` first: `!succeeded` ⇒
`failed`; else `noop` ⇒ `no-op`; else `success`. `noop` stays purely structural
(`changes.length === 0`).

### Failure states are emitted, not just modeled

The `status: "failed"` / `hasFailures: true` / `succeeded: false` (and
`changed: "false"`) states are **reachable and actually emitted**. On a typed
failure (input parsing, validation, or landing) `program.ts` emits a structured
failed `result` via an `emitFailure` helper **before** re-raising the error, so
the action still exits non-zero while downstream consumers still see a
well-formed failed `result`. Because that emission runs first, it is wrapped in
`Effect.catchCause` so a failing output write can never displace the real cause
— see the control-flow note in [architecture.md](./architecture.md).

### Convenience scalar outputs

Emitted alongside `result` (non-fatal): `status`, `changed` (`true`/`false`),
`mode`, `commit-sha`, `commit-url`, `pr-number`, `pr-url`, `plugins-updated`.

> **Testing note.** The `ActionOutputs.layerTest` double for `setJson` in
> `__test__/program.test.ts` **must encode through the schema it is handed**,
> exactly as the real `setJson` does. A double that accepts the schema and
> ignores it makes every `result` assertion structurally incapable of catching a
> projection/schema drift: production would fail to encode, `program.ts` would
> demote that to a `logWarning`, and the machine-readable `result` would
> silently vanish with the suite green. The double raises the encode failure as
> a **defect** (`orDie`), which is the one place it is deliberately *stricter*
> than production — production degrades gracefully because losing `result`
> should not fail a run that already did its work; in a test the same event is a
> contract bug and has to be loud.

### Job summary

A markdown job summary is written (non-fatal — a failure demotes to
`logWarning`). The spec anticipates an optional sticky PR comment in `pr` mode;
that is **not yet implemented** in `program.ts`.

## Default messages

When `commit-message`/`pr-title`/`pr-body` are unset, they are generated from the
applied change set (`report.ts`), matching silk conventions:

- **Subject / PR title** — `ai(marketplace): <summary>`: one plugin →
  `repinned <pluginName>@<manifestName>`; multiple → `repinned <N> plugins`.
- **Body / PR body** — one bullet per changed field per plugin: `pinned … to
  <sha>` / `changed path of … to <path>` / `changed url of … to <url>`.
- **Commit message only** — a blank line then a `Signed-off-by: <name> <email>`
  DCO trailer from `GitHubToken.botIdentity()`. The PR body omits the trailer.
  See [verified-commits.md](./verified-commits.md) for why the trailer is message
  text, never author/committer metadata.
