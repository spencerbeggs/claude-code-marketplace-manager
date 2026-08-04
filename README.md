# Claude Code Marketplace Manager

[![GitHub release](https://img.shields.io/github/v/release/spencerbeggs/claude-code-marketplace-manager?label=release&color=2088ff)](https://github.com/spencerbeggs/claude-code-marketplace-manager/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT) [![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

A GitHub Action that partial-merge edits `git-subdir` plugin entries in a Claude Code marketplace manifest (`.claude-plugin/marketplace.json`), validates the result, and lands the change as a verified commit or a pull request.

## Why Marketplace Manager

Re-pinning a plugin in a marketplace manifest by hand means editing JSON, keeping the file valid, and getting a signed commit past branch protection. This action does all three from a single workflow step. It applies only the explicit `url`, `path`, and `sha` values you pass — no "latest" lookup and no ref-to-sha resolution — so a run changes exactly what you asked for and nothing else. Edits preserve the file's existing formatting and comments, and commits are signed server-side through a GitHub App, which satisfies a "require signed commits" branch protection rule.

## Usage

The action reads the manifest from the checked-out repository, so the job needs `actions/checkout` and write permissions. Authentication is a GitHub App (see [Authentication](#authentication)).

This example accepts changes from two triggers: a manual `workflow_dispatch` (fill in the form in the Actions tab) and a `repository_dispatch` sent by another repository (see [Triggering from another repository](#triggering-from-another-repository) below). The two triggers populate different contexts — `inputs.*` for `workflow_dispatch`, `github.event.client_payload.*` for `repository_dispatch` — so each `with:` value picks the right one based on `github.event_name`:

```yaml
name: Repin Claude Code Plugins
on:
    workflow_dispatch:
        inputs:
            name:
                description: Name of the plugin to repin
                required: false
                type: string
            sha:
                description: Commit SHA to repin to
                required: false
                type: string
            path:
                description: The path to the plugin root in the repository
                required: false
                type: string
            url:
                description: Source repository URL for the plugin
                required: false
                type: string
            json:
                description: JSON object with a plugins array of per-plugin partial-merge patches
                required: false
                type: string
    repository_dispatch:
        types: [plugin-release]
permissions:
    contents: write
    pull-requests: write
concurrency:
    group: repin-plugins
    cancel-in-progress: false
jobs:
    repin:
        runs-on: ubuntu-latest
        permissions:
            contents: write
            pull-requests: write
        steps:
            - uses: actions/checkout@v7
              with:
                  fetch-depth: 0
            - uses: spencerbeggs/claude-code-marketplace-manager@v1
              with:
                  app-client-id: ${{ secrets.APP_CLIENT_ID }}
                  app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
                  name: ${{ github.event_name == 'workflow_dispatch' && inputs.name || github.event.client_payload.name }}
                  sha: ${{ github.event_name == 'workflow_dispatch' && inputs.sha || github.event.client_payload.sha }}
                  path: ${{ github.event_name == 'workflow_dispatch' && inputs.path || github.event.client_payload.path }}
                  url: ${{ github.event_name == 'workflow_dispatch' && inputs.url || github.event.client_payload.url }}
                  json: ${{ github.event_name == 'workflow_dispatch' && inputs.json || github.event.client_payload.json }}
                  mode: "pr"
                  auto-merge: "rebase"
```

### Triggering from another repository

A plugin's own repository — the one that builds and publishes it — usually knows about a new release before the marketplace repo does. Instead of relying on `workflow_dispatch` (a human filling in a form) or a schedule, have the publishing repo's release workflow notify the marketplace repo directly with a `repository_dispatch` event as its last step. The `types: [plugin-release]` trigger above fires on any `event_type` you choose here — `plugin-release` is just a name both sides need to agree on.

`repository_dispatch` events cross a repository boundary, so the default `GITHUB_TOKEN` cannot send one — it is scoped to the repo the workflow runs in. Use a token that has access to the marketplace repo instead (a GitHub App installation token or a PAT with `repo` scope), stored as a secret in the **publishing** repo.

Using the GitHub CLI (no extra action needed):

```yaml
# .github/workflows/release.yml — in the plugin's own repository
name: Release
on:
    push:
        tags: ["v*"]
jobs:
    release:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
            # ...build/publish/tag steps...
            - name: Notify the marketplace repo
              env:
                  GH_TOKEN: ${{ secrets.MARKETPLACE_DISPATCH_TOKEN }}
              run: |
                  gh api repos/OWNER/MARKETPLACE_REPO/dispatches \
                    -f event_type=plugin-release \
                    -F 'client_payload[name]=vitest-agent' \
                    -F 'client_payload[sha]=${{ github.sha }}'
```

Using [`peter-evans/repository-dispatch`](https://github.com/peter-evans/repository-dispatch):

```yaml
- uses: peter-evans/repository-dispatch@v3
  with:
      token: ${{ secrets.MARKETPLACE_DISPATCH_TOKEN }}
      repository: OWNER/MARKETPLACE_REPO
      event-type: plugin-release
      client-payload: '{"name": "vitest-agent", "sha": "${{ github.sha }}"}'
```

Either way, `client_payload` should carry the same fields this action's manual path accepts (`name` plus at least one of `url`/`path`/`sha`, or a `json` array for several plugins at once) — the marketplace repo's workflow reads them back out via `github.event.client_payload.*`, exactly as shown in the combined example above.

## Authentication

Commits are made through a GitHub App installation token, which is what makes them verified. Personal access tokens and the default `GITHUB_TOKEN` do not produce verified commits, so they are not supported.

1. Create a GitHub App with **Contents: read & write** and **Pull requests: read & write** repository permissions.
2. Install it on the repository whose manifest you want to update.
3. Store the App's client ID and private key (PEM) as repository or organization secrets.
4. Pass them as `app-client-id` and `app-private-key`.

The installation token is minted at the start of the run and revoked at the end.

## Inputs

Provide changes in one of two mutually exclusive ways: the **manual** path (`name` plus at least one of `url`/`path`/`sha`) or the **programmatic** path (`json`). Passing both is an error.

| Input | Required | Default | Description |
| ----- | -------- | ------- | ----------- |
| `name` | manual path | `""` | Plugin name to update. Requires at least one of `url`/`path`/`sha`. |
| `url` | no | `""` | New `source.url` for the named plugin. |
| `path` | no | `""` | New `source.path` for the named plugin. |
| `sha` | no | `""` | New `source.sha` (40-hex commit) for the named plugin. |
| `json` | programmatic path | `""` | JSON object with a `plugins` array of per-plugin partial-merge patches, `{ "plugins": [{ "name": string, "url"?, "path"?, "sha"? }] }`. Each entry names an existing plugin and changes only the fields it provides. Validated against the committed [input schema](claude-code-marketplace-manager.input.json). |
| `mode` | no | `commit` | `commit` (commit direct to the base branch) or `pr` (open a pull request). |
| `base-branch` | no | repo default branch | Branch to commit to (`commit` mode) or the PR base (`pr` mode). |
| `branch` | no | `chore/repin-plugins` | PR head branch (`pr` mode). Force-reset onto the base branch on every run — any commits an earlier run left on it are discarded. |
| `commit-message` | no | generated | Commit message. Generated from the applied changes when unset. |
| `pr-title` | no | generated | PR title (`pr` mode). Generated when unset. |
| `pr-body` | no | generated | PR body (`pr` mode). Generated when unset. |
| `auto-merge` | no | `rebase` | Merge method (`merge`, `squash`, or `rebase`) to enable auto-merge with on the opened/updated PR. Only applies in `pr` mode; ignored in `commit` mode. |
| `dry-run` | no | `false` | Validate and emit the summary and outputs, but make no commit or PR. |
| `app-client-id` | yes | — | GitHub App client ID. |
| `app-private-key` | yes | — | GitHub App private key (PEM). |

## Outputs

| Output | Description |
| ------ | ----------- |
| `result` | Structured JSON describing the run, governed by the committed [output schema](claude-code-marketplace-manager.output.json). The scalars below mirror its common fields. |
| `status` | `no-op`, `success`, or `failed`. |
| `changed` | `true` when the manifest was modified. |
| `mode` | `commit` or `pr`. |
| `commit-sha` | SHA of the verified commit, or empty. |
| `commit-url` | HTML URL of the commit, or empty. |
| `pr-number` | PR number (`pr` mode), or empty. |
| `pr-url` | PR URL (`pr` mode), or empty. |
| `plugins-updated` | Count of plugins whose fields changed. |

The `result` payload carries the full contract:

```json
{
  "$schema": "https://raw.githubusercontent.com/spencerbeggs/claude-code-marketplace-manager/main/claude-code-marketplace-manager.output.json",
  "schemaVersion": "1",
  "mode": "commit",
  "status": "success",
  "noop": false,
  "succeeded": true,
  "hasFailures": false,
  "dryRun": false,
  "pluginsUpdated": 1,
  "plugins": [{ "name": "vitest-agent", "fields": ["sha"] }],
  "commit": { "sha": "<40-hex>", "url": "<commit html url>" },
  "pr": null
}
```

Read a scalar in a later step:

```yaml
- id: repin
  uses: spencerbeggs/claude-code-marketplace-manager@v1
  with:
    name: vitest-agent
    sha: 8cba76025762cfa1dca24e6daafe2e3dc7c14924
    app-client-id: ${{ secrets.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
- run: echo "status=${{ steps.repin.outputs.status }} sha=${{ steps.repin.outputs.commit-sha }}"
  # status=success sha=<40-hex commit sha>
```

## Behavior

- **Validation before landing.** The edited manifest is validated (ajv structural checks plus semantic checks) before anything is committed. On failure the file is left untouched and the run fails.
- **No-op safety.** When the requested changes leave the manifest byte-for-byte unchanged, the run reports `status: no-op` and makes no commit or PR.
- **Generated messages.** With `commit-message`, `pr-title`, and `pr-body` unset, the default subject is `ai(marketplace): repinned <plugin>@<manifest>` (or `repinned N plugins` for several) with a DCO `Signed-off-by:` trailer from the App bot.
- **Dry run.** `dry-run: true` runs the full edit and validation and populates the outputs, but writes no commit or PR.
- **Auto-merge.** In `pr` mode, the opened (or reused) PR has auto-merge enabled with the `auto-merge` method (default `rebase`) via GitHub's native auto-merge — the PR still merges only once required checks and reviews pass. Auto-merge is applied as a separate step after the pull request is opened or updated, so a repository that refuses the requested merge method still gets its pull request. Re-running the action against the same open PR re-applies auto-merge with the current method. Has no effect in `commit` mode.

## Examples

Update several plugins at once through the programmatic path:

```yaml
- uses: spencerbeggs/claude-code-marketplace-manager@v1
  with:
    json: |
      {
        "plugins": [
          { "name": "vitest-agent", "sha": "8cba76025762cfa1dca24e6daafe2e3dc7c14924" },
          { "name": "silk", "path": "plugins/silk", "url": "https://github.com/savvy-web/silk" }
        ]
      }
    app-client-id: ${{ secrets.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

Open a pull request instead of committing to the base branch (auto-merge defaults to `rebase`):

```yaml
- uses: spencerbeggs/claude-code-marketplace-manager@v1
  with:
    name: vitest-agent
    sha: 8cba76025762cfa1dca24e6daafe2e3dc7c14924
    mode: pr
    branch: chore/repin-vitest-agent
    app-client-id: ${{ secrets.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

Every `pr`-mode run re-roots the head branch at the base branch's current tip: the commit is built against that tip first, then the head branch is moved straight to the finished commit in one step. Re-running against the same `branch` updates the existing pull request in place instead of stacking another commit on it, and the branch never passes through a state where it equals base. Each run leaves a single commit that diffs cleanly against the current base. Treat that branch as owned by the action: commits pushed to it by anything else are discarded on the next run.

Open a pull request with a specific auto-merge method:

```yaml
- uses: spencerbeggs/claude-code-marketplace-manager@v1
  with:
    name: vitest-agent
    sha: 8cba76025762cfa1dca24e6daafe2e3dc7c14924
    mode: pr
    auto-merge: squash
    app-client-id: ${{ secrets.APP_CLIENT_ID }}
    app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

## Requirements

- Node.js >=24.11.0 (supplied by the `node24` runtime; no local install needed).
- A GitHub App with `contents: write` and `pull_requests: write`, installed on the target repository.
- A `.claude-plugin/marketplace.json` manifest in the checked-out repository.

## License

[MIT](LICENSE)
