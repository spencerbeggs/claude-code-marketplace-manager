---
status: current
module: marketplace-manager
category: architecture
created: 2026-07-23
updated: 2026-07-24
last-synced: 2026-07-24
completeness: 90
related:
  - ./architecture.md
  - ./validation.md
dependencies:
  - effect@4.0.0-beta.101
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

| Input | Default | Purpose |
| ------- | --------- | --------- |
| `mode` | `commit` | `commit` (direct to base) or `pr`. |
| `base-branch` | repo default branch | Branch committed to / PR base. `null` ⇒ resolved at runtime via `repos.get`. |
| `branch` | `chore/repin-plugins` | PR head branch (pr mode). |
| `commit-message` / `pr-title` / `pr-body` | generated (§ default messages) | Overrides. Empty string ⇒ `null` ⇒ use generated default. |
| `auto-merge` | `rebase` | `merge`\|`squash`\|`rebase`, validated in `inputs.ts` (invalid value ⇒ `InvalidInputError`). Threaded into `ManifestCommitter.land`'s `pr`-mode branch as `PullRequest.getOrCreate`'s `autoMerge` option, which enables GitHub's native auto-merge via the library's `enablePullRequestAutoMerge` GraphQL mutation. Read but unused in `commit` mode — there is no PR to enable it on. |
| `dry-run` | `false` | Validate + emit output, skip commit/PR. |
| `app-client-id` / `app-private-key` | — (required) | GitHub App credentials. |

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
well-formed failed `result`. See the control-flow note in
[architecture.md](./architecture.md).

### Convenience scalar outputs

Emitted alongside `result` (non-fatal): `status`, `changed` (`true`/`false`),
`mode`, `commit-sha`, `commit-url`, `pr-number`, `pr-url`, `plugins-updated`.

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
