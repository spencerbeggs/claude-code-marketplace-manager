---
"claude-code-marketplace-manager": patch
---

## Bug Fixes

* Fixed a `pr` mode race where the action's own pull request could be auto-closed by GitHub. The landing sequence now builds the finished commit first and moves the head branch straight onto it with a single update, so the branch never passes through a state where it's identical to `base` (which GitHub reads as an empty diff and auto-closes). The existing force-reset guarantee is unchanged: every `pr`-mode run still discards the previous run's commits and re-roots on `base`'s current tip.
* Auto-merge is now requested as a separate step after the pull request is opened or updated, so a repository that rejects the requested merge method no longer makes PR creation itself look like it failed. A failure to enable auto-merge still fails the run.

## Refactoring

* Default-branch resolution now goes through the library's repository service instead of a hand-written API type cast.
* Consolidated four internal error types into a single structured error with a `kind` field, and collapsed duplicate layer wiring between the `pre` and `post` phases.
