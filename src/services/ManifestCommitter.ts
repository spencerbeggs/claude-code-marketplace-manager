import type { GitHubError, GitHubGraphQLError } from "@effected/github";
import { FileContent, GitBranch, GitCommit, GitHubRepository, PullRequest, Repo } from "@effected/github";
import { Effect } from "effect";
import { MANIFEST_PATH } from "./ManifestEditor.js";
import type { ValidatedManifestChange } from "./ManifestValidator.js";

/** Outcome of landing an edit. */
export interface LandResult {
	readonly commitSha: string | null;
	readonly commitUrl: string | null;
	readonly prNumber: number | null;
	readonly prUrl: string | null;
}

/** Parameters for {@link land}. */
export interface LandParams {
	readonly mode: "commit" | "pr";
	readonly base: string;
	readonly branch: string;
	/**
	 * The manifest change to commit. Requiring the branded, validator-minted type
	 * rather than a plain `string` is what makes "land unvalidated or byte-stable
	 * text" a compile error instead of a convention.
	 */
	readonly change: ValidatedManifestChange;
	readonly commitMessage: string;
	readonly prTitle: string;
	readonly prBody: string;
	/** Auto-merge method to enable on the PR. Read only in `pr` mode. */
	readonly autoMerge: "merge" | "squash" | "rebase";
}

/**
 * Resolve the base branch: the input when set, else the repo's default branch.
 *
 * @remarks
 * `GitHubRepository.defaultBranch` replaces a hand-written `ReposGetOctokit`
 * interface and a `client.rest<{ default_branch }>("repos.get", …)` callback
 * that had to be cast into place. The route is the key, so there is nothing
 * left to cast.
 */
export const resolveBaseBranch = (input: string | null): Effect.Effect<string, GitHubError, GitHubRepository | Repo> =>
	input !== null ? Effect.succeed(input) : Effect.flatMap(GitHubRepository, (repository) => repository.defaultBranch);

/**
 * Land the edit per `mode`.
 *
 * @remarks
 * **Never passes author, committer or signature.** Server-side signing is what
 * makes these commits verified, and on `@effected/github` the rule is
 * structural rather than remembered: `GitCommit` exposes no such parameter to
 * pass. The bot identity reaches the commit only as the DCO `Signed-off-by:`
 * trailer inside `commitMessage` text.
 *
 * **The `pr`-mode sequence builds the commit before moving the ref** (ruling
 * D-2). The obvious spelling — reset the head branch onto base, then commit to
 * it — leaves a window in which the head branch *is* base, so an open PR from
 * it has an empty diff and GitHub auto-closes it. `@effected/github` documents
 * this against `GitBranch.upsert` and names this action as the consumer whose
 * four-round-trip create-or-reset dance the API was built to replace:
 *
 * > When the end state is "the target head plus a commit", build the commit
 * > first — `GitCommit.get` the target for its `treeSha`, `createTree` on it,
 * > `createCommit` with the target as parent — and upsert **once**, straight to
 * > the finished sha, so the ref never rests on the bare target head.
 *
 * The force-reset invariant is unchanged and is what the single `upsert` now
 * expresses: every `pr`-mode run re-roots the head branch at base's *current*
 * tip, discarding whatever an earlier run left there. That is deliberate — the
 * `branch` input defaults to a fixed name reused run over run, and without the
 * re-rooting the PR drifts until it conflicts. The branch is action-owned; a
 * human commit pushed onto it is collateral.
 *
 * `upsert` also subsumes the pre-port `exists` / `create` / re-check-on-failure
 * recovery: a concurrent creator is recognized structurally through
 * `kind: "alreadyExists"` rather than by matching error prose, and the recovery
 * resets rather than inheriting a branch rooted somewhere else.
 */
export const land = (
	params: LandParams,
): Effect.Effect<LandResult, GitHubError | GitHubGraphQLError, GitCommit | GitBranch | PullRequest | Repo> =>
	Effect.gen(function* () {
		const commit = yield* GitCommit;
		const { owner, repo } = yield* Repo;
		const changes = [new FileContent({ path: MANIFEST_PATH, content: params.change.editedText })];
		const commitUrl = (sha: string): string => `https://github.com/${owner}/${repo}/commit/${sha}`;

		if (params.mode === "commit") {
			// `commitFiles` reads the base head as the parent itself.
			const sha = yield* commit.commitFiles({
				branch: params.base,
				message: params.commitMessage,
				changes,
			});
			return { commitSha: sha, commitUrl: commitUrl(sha), prNumber: null, prUrl: null };
		}

		const branch = yield* GitBranch;
		const pulls = yield* PullRequest;

		// Build the finished commit against base FIRST — see the remarks above.
		const baseSha = yield* branch.sha(params.base);
		const baseCommit = yield* commit.get(baseSha);
		const tree = yield* commit.createTree({ changes, baseTree: baseCommit.treeSha });
		const sha = yield* commit.createCommit({
			message: params.commitMessage,
			tree,
			parents: [baseCommit.sha],
		});

		// ...then move the ref exactly once, straight to it. The head branch never
		// rests on the bare base head, so no open PR is briefly empty.
		yield* branch.upsert(params.branch, sha);

		const { pullRequest } = yield* pulls.upsert({
			title: params.prTitle,
			head: params.branch,
			base: params.base,
			body: params.prBody,
		});
		// A separate call, not an option on upsert: an auto-merge failure must not
		// be reported as though opening the PR had failed.
		yield* pulls.setAutoMerge(pullRequest, params.autoMerge);

		return {
			commitSha: sha,
			commitUrl: commitUrl(sha),
			prNumber: pullRequest.number,
			prUrl: pullRequest.url,
		};
	});
