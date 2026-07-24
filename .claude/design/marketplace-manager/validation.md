---
status: current
module: marketplace-manager
category: validation
created: 2026-07-23
updated: 2026-07-24
last-synced: 2026-07-24
completeness: 92
related:
  - ./architecture.md
  - ./input-output-contracts.md
dependencies:
  - ajv
  - "@effected/jsonc"
---

# marketplace-manager — manifest validation

## Invariant

The **resulting** manifest is validated *before any commit*. On any violation the
action fails with `ManifestValidationError` (carrying **all** reasons) and leaves
the file untouched — an invalid manifest is never committed. Validation runs in
`program.ts` step 5, after the no-op guard and before the dry-run guard, so even
`dry-run` exercises full validation.

### The invariant is type-enforced, not merely ordered

Both halves — *validated* and *non-no-op* — are compile-time requirements of
`ManifestCommitter.land`, not properties that `runOrchestration`'s statement
order happens to produce:

- **Non-no-op:** `EditResult` is a union of `NoopEdit` (`changed: false`,
  `changes: readonly []`) and `ChangedEdit` (`changed: true`). Narrowing past the
  no-op guard is the only way to obtain a `ChangedEdit`, and `validateEdit`
  accepts nothing else. This also makes `changes` structurally consistent with
  `changed`, replacing a runtime consistency check in `applyPatches`.
- **Validated:** `validateEdit(edit, patchedNames)` runs `validateManifest` and,
  on success, mints a branded `ValidatedManifestChange`
  (`Brand.Branded<…, "ValidatedManifestChange">`). `land` requires that type
  rather than a plain `string`, so committing unvalidated or byte-stable text is
  a compile error.

`validateManifest(editedText, patchedNames)` remains the exported, unbranded
check; `validateEdit` is the proof-carrying wrapper around it. A deliberate cast
can still forge a branded value — out of scope, as with any cast.

## Two layers of checks (`services/ManifestValidator.ts`)

`validateManifest(editedText, patchedNames)`:

1. Parses the edited text with `@effected/jsonc` (`Jsonc.parse`). A parse failure
   is itself a validation error (`resulting manifest is not valid JSON/JSONC`).
2. **Structural (ajv):** compiles the bundled SchemaStore schema
   `src/schema/claude-code-marketplace.json` and validates the parsed data.
3. **Semantic:** the checks JSON Schema can't express (below).
4. Accumulates all errors (`allErrors: true`) and fails once with the full list.

### ajv configuration — deliberately `strict: false`

```ts
new Ajv({ strict: false, allErrors: true, logger: false })
```

- The bundled schema's `$schema` is draft-07, handled by the default `Ajv` export.
- `strict: false` is **intentional**: we validate third-party **data** against a
  SchemaStore schema, not strict-lint the schema itself; strict mode can throw on
  its keywords/formats.
- `logger: false` silences "unknown format" warnings — `ajv-formats` is not
  shipped, so `uri`/`uri-reference` formats go unvalidated at the structural
  layer. That is fine because the semantic layer re-validates `url` for every
  touched plugin.

> Drift note: the original design spec called for `strict: true`; the shipped
> implementation uses `strict: false` for the reasons above. This doc reflects
> the code.

### Semantic checks

Applied globally where noted, and only to **touched** plugins (`patchedNames`)
otherwise:

- **Uniqueness (all plugins):** no duplicate plugin `name`. Nameless plugins are
  treated as a structural error, not a duplicate.
- **Presence (touched):** each patched name still exists in `plugins[]` after the
  edit (`patched plugin not present after edit: <name>`).
- **Source shape (touched):** `source.source === "git-subdir"`.
- **`url` (touched):** matches a GitHub URL —
  `^https://github\.com/[^/]+/[^/]+(?:\.git)?/?$`.
- **`path` (touched):** a non-empty string.
- **`sha` (touched):** 40-hex lowercase (`^[0-9a-f]{40}$`).

Only touched plugins get the per-field re-check, so pre-existing entries the run
did not modify are not retroactively rejected — keeping edits precise and
byte-stable.

## Relationship to the edit step

The editor (`ManifestEditor.applyPatches`) is format-preserving (`@effected/jsonc`)
and matches patches to plugins by `name`; a patch naming an absent plugin fails
earlier with `PluginNotFoundError` (a distinct error from
`ManifestValidationError`). Validation therefore focuses on the *result* of a
successful edit, not on patch resolution.
