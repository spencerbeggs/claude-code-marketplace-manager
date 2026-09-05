# claude-code-marketplace-manager

## 1.0.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/github | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/github-actions | dependency | updated | ^0.10.1 | ^0.10.1 |
| @effected/jsonc | dependency | updated | ^0.8.0 | ^0.8.0 |

[#37][#37]

[#37][#37]

[#37][#37]

[#37][#37]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#37]: https://github.com/spencerbeggs/claude-code-marketplace-manager/pull/37

## 1.0.4

### Maintenance

- Adopts `effect@rc.109`

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 1.0.3

### Bug Fixes

- `land` now refuses `pr` mode when `base` and `branch` are the same. Previously nothing stopped the two from colliding, and the single `GitBranch.upsert` would move the *base* branch itself onto the new commit — landing an unreviewed change directly on it, with the pull request call only failing afterward on a head equal to its base. The guard runs before the commit is built, so `land`'s error channel now also includes `InvalidInputError`. `commit` mode is unaffected — it never reads `branch`. [#20][#20]

* Fixed a `pr` mode race where the action's own pull request could be auto-closed by GitHub. The landing sequence now builds the finished commit first and moves the head branch straight onto it with a single update, so the branch never passes through a state where it's identical to `base` (which GitHub reads as an empty diff and auto-closes). The existing force-reset guarantee is unchanged: every `pr`-mode run still discards the previous run's commits and re-roots on `base`'s current tip.
* Auto-merge is now requested as a separate step after the pull request is opened or updated, so a repository that rejects the requested merge method no longer makes PR creation itself look like it failed. A failure to enable auto-merge still fails the run.

### Refactoring

- Default-branch resolution now goes through the library's repository service instead of a hand-written API type cast.
- Consolidated four internal error types into a single structured error with a `kind` field, and collapsed duplicate layer wiring between the `pre` and `post` phases. [#20][#20]

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/jsonc | dependency | updated | \~0.5.1 | \~0.5.2 | [#17][#17] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

* | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @savvy-web/github-action-effects | dependency | removed | ^3.1.0 | — |  |
  | @effected/github | dependency | added | — | \~0.2.2 |  |
  | @effected/github-actions | dependency | added | — | \~0.5.0 | [#20][#20] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#17]: https://github.com/spencerbeggs/claude-code-marketplace-manager/pull/17

[#20]: https://github.com/spencerbeggs/claude-code-marketplace-manager/pull/20

## 1.0.2

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @savvy-web/github-action-effects | dependency | updated | ^3.0.5 | ^3.1.0 | [#8][#8] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#8]: https://github.com/spencerbeggs/claude-code-marketplace-manager/pull/8

## 1.0.1

### Bug Fixes

- `pr` mode now resets the head branch onto the base branch before committing, so re-running against the same `branch` updates the existing pull request in place instead of stacking another commit onto an increasingly stale base. Because `branch` defaults to a fixed name reused run over run, the old behavior let long-lived branches drift until the pull request reported a merge conflict.
- Each `pr`-mode run now leaves a single commit that diffs cleanly against the current base. Treat that branch as owned by the action: commits pushed to it by anything else are discarded on the next run.

### Refactoring

- `ManifestCommitter.land` now takes a validated, non-no-op manifest change rather than raw text, making "commit unvalidated text" and "commit byte-identical text" compile errors instead of ordering conventions. `EditResult` became a `NoopEdit | ChangedEdit` union and `ManifestValidator.validateEdit` mints the branded value `land` accepts. Internal only — no input or output contract changed. [#6][#6]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#6]: https://github.com/spencerbeggs/claude-code-marketplace-manager/pull/6

## 1.0.0

### Features

- ### Marketplace Manager action
  New GitHub Action that re-pins `git-subdir` plugin entries in a Claude Code marketplace manifest (`.claude-plugin/marketplace.json`) and lands the edit as a verified commit or a pull request. First release.
  - **Explicit values only.** Applies exactly the `url`, `path`, and `sha` you pass — no "latest" lookup, no ref-to-sha resolution. A run changes exactly what you asked for.
  - **Two mutually exclusive input paths:** a manual single-plugin path (`name` plus at least one of `url`/`path`/`sha`), or a programmatic `json` path — an object with a `plugins` array of per-plugin partial-merge patches (`{"plugins":[{"name":"...","sha":"..."}]}`). Omitted fields on a patched plugin are left untouched.
  - **Validated before landing.** The edited manifest is checked against both structural (JSON Schema) and semantic rules before anything is committed; on failure the file is left untouched and the run fails. A no-op edit (manifest byte-for-byte unchanged) reports `status: no-op` and makes no commit or PR.
  - **Verified commits.** Lands via `mode: commit` (direct to the base branch) or `mode: pr` (opens/updates a pull request), signed server-side through a GitHub App installation token — satisfying "require signed commits" branch protection. Default commit/PR messages follow `ai(marketplace): repinned <plugin>@<manifest>` with a DCO `Signed-off-by:` trailer from the App bot identity.
  - **Auto-merge.** In `pr` mode, the opened/updated PR has auto-merge enabled via the `auto-merge` input (`merge`, `squash`, or `rebase`; defaults to `rebase`), using GitHub's native auto-merge so the PR still waits on required checks and reviews. No effect in `commit` mode.
  - **Structured output.** Emits a `result` JSON payload (governed by a committed, drift-tested JSON Schema) plus convenience scalars (`status`, `changed`, `mode`, `commit-sha`, `commit-url`, `pr-number`, `pr-url`, `plugins-updated`), and a markdown job summary.

  ```yaml
  - uses: spencerbeggs/claude-code-marketplace-manager@v1
    with:
      name: vitest-agent
      sha: 8cba76025762cfa1dca24e6daafe2e3dc7c14924
      app-client-id: ${{ secrets.APP_CLIENT_ID }}
      app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
  ```
