---
status: current
module: marketplace-manager
category: security
created: 2026-07-23
updated: 2026-07-23
last-synced: 2026-07-23
completeness: 95
related:
  - ./architecture.md
dependencies:
  - "@savvy-web/github-action-effects"
---

# marketplace-manager — verified commits (load-bearing design decision)

## Why this document exists

The single most important, easiest-to-break design fact of this action is how it
produces **GPG-verified** commits that satisfy "require signed commits" branch
protection — including committing directly to the default branch. The prior
bash/git-CLI implementation could not do this. Getting this wrong reintroduces
the original bug.

## The mechanism

The action uses the library's `GitCommit.commitFiles` and relies on **GitHub's
server-side commit signing**. The chain of facts:

1. **The token is a genuine GitHub App installation access token** (not a PAT).
   `GitHubToken.provision` → `GitHubApp.generateToken` → `InstallationToken`;
   `GitHubClientLive.fromToken` authenticates Octokit with it directly.
2. **`GitCommit.commitFiles` sends no custom author / committer / signature.**
   Its Live impl calls `git.createCommit({ owner, repo, message, tree, parents })`
   only.
3. **GitHub server-signs API commits made by a bot/App token when the request
   omits custom author/committer/signature**, returning `verified: true` and
   attributing the commit to the App's bot identity. A server signature satisfies
   "require signed commits" branch protection, so commit-direct-to-main works.
   PATs do not trigger this; App tokens do.

## The key implementation rule

**Do NOT stamp `GitHubToken.botIdentity()` onto the commit's author/committer
fields.** Doing so would defeat auto-signing (it violates fact 2). `GitCommit`
already omits those fields — which is exactly why the commit stays verified —
and GitHub fills in the bot identity (author + committer) itself.

In this codebase the rule is honored structurally: `ManifestCommitter.land`
builds `files = [{ path, content }]` and calls `commit.commitFiles(ref, message,
files)` with **no identity arguments** (`src/services/ManifestCommitter.ts`).
There is no author/committer parameter to pass.

## DCO sign-off is different — and required

The generated commit message carries a `Signed-off-by: <name> <email>` trailer
built from `GitHubToken.botIdentity()`. This is **message text, not
author/committer metadata**, so it does not disturb auto-signing. Because GitHub
sets the commit author to the same App bot (a consequence of omitting the
fields), the DCO sign-off matches the actual author — the commit is
simultaneously **verified** and carries a **valid DCO** from its author.

This is the *sanctioned* use of `botIdentity()`:

- ✅ Compose the DCO trailer string in the commit **message** (`report.ts` builds
  the default message; `program.ts` reads `botIdentity()` only on the land path).
- ❌ Never set it as the commit **author/committer field**.

The PR body omits the DCO trailer; only the commit message carries it.

## Where `botIdentity()` is read

`program.ts` reads `GitHubToken.botIdentity()` **only** on the land path (after
the dry-run guard). Dry runs never read the token identity, so the dry-run code
path needs no provisioned token — an important test/ergonomics property.

## Reference implementation

`savvy-web/silk-update-action` ships this same pattern: `GitCommitLive` wired
from `GitHubToken.client()`, committed via `commit.commitFiles(branch, message,
[{ path, content }])` with no author. It commits to a feature branch then PRs;
this action's commit-direct-to-main mode additionally relies on fact (3) above.

## Acceptance invariant

`commit` mode must land a verified commit on the base branch that passes
signed-commit branch protection; `pr` mode's commit must likewise be verified.
Any change that introduces an author/committer argument to the commit call
breaks this and must be rejected in review.
