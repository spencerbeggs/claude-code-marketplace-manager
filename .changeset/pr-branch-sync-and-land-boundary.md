---
"claude-code-marketplace-manager": patch
---

## Bug Fixes

* `pr` mode now resets the head branch onto the base branch before committing, so re-running against the same `branch` updates the existing pull request in place instead of stacking another commit onto an increasingly stale base. Because `branch` defaults to a fixed name reused run over run, the old behavior let long-lived branches drift until the pull request reported a merge conflict.
* Each `pr`-mode run now leaves a single commit that diffs cleanly against the current base. Treat that branch as owned by the action: commits pushed to it by anything else are discarded on the next run.

## Refactoring

* `ManifestCommitter.land` now takes a validated, non-no-op manifest change rather than raw text, making "commit unvalidated text" and "commit byte-identical text" compile errors instead of ordering conventions. `EditResult` became a `NoopEdit | ChangedEdit` union and `ManifestValidator.validateEdit` mints the branded value `land` accepts. Internal only — no input or output contract changed.
