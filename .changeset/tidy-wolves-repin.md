---
"claude-code-marketplace-manager": major
---

## Features

### Marketplace Manager action

New GitHub Action that re-pins `git-subdir` plugin entries in a Claude Code marketplace manifest (`.claude-plugin/marketplace.json`) and lands the edit as a verified commit or a pull request. First release.

* **Explicit values only.** Applies exactly the `url`, `path`, and `sha` you pass — no "latest" lookup, no ref-to-sha resolution. A run changes exactly what you asked for.
* **Two mutually exclusive input paths:** a manual single-plugin path (`name` plus at least one of `url`/`path`/`sha`), or a programmatic `json` path — an object with a `plugins` array of per-plugin partial-merge patches (`{"plugins":[{"name":"...","sha":"..."}]}`). Omitted fields on a patched plugin are left untouched.
* **Validated before landing.** The edited manifest is checked against both structural (JSON Schema) and semantic rules before anything is committed; on failure the file is left untouched and the run fails. A no-op edit (manifest byte-for-byte unchanged) reports `status: no-op` and makes no commit or PR.
* **Verified commits.** Lands via `mode: commit` (direct to the base branch) or `mode: pr` (opens/updates a pull request), signed server-side through a GitHub App installation token — satisfying "require signed commits" branch protection. Default commit/PR messages follow `ai(marketplace): repinned <plugin>@<manifest>` with a DCO `Signed-off-by:` trailer from the App bot identity.
* **Auto-merge.** In `pr` mode, the opened/updated PR has auto-merge enabled via the `auto-merge` input (`merge`, `squash`, or `rebase`; defaults to `rebase`), using GitHub's native auto-merge so the PR still waits on required checks and reviews. No effect in `commit` mode.
* **Structured output.** Emits a `result` JSON payload (governed by a committed, drift-tested JSON Schema) plus convenience scalars (`status`, `changed`, `mode`, `commit-sha`, `commit-url`, `pr-number`, `pr-url`, `plugins-updated`), and a markdown job summary.

```yaml
- uses: spencerbeggs/claude-code-marketplace-manager@v1
  with:
    name: vitest-agent
    sha: 8cba76025762cfa1dca24e6daafe2e3dc7c14924
    app-client-id: ${{ secrets.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```
