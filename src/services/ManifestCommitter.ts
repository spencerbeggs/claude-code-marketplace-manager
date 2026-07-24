import type {
	GitBranchError,
	GitCommitError,
	GitHubClientError,
	PullRequestError,
} from "@savvy-web/github-action-effects";
import { GitBranch, GitCommit, GitHubClient, PullRequest } from "@savvy-web/github-action-effects";
import { Effect } from "effect";
import { MANIFEST_PATH } from "./ManifestEditor.js";
import type { ValidatedManifestChange } from "./ManifestValidator.js";

/** Minimal shape of the octokit `repos.get` REST method, cast from `unknown`. */
interface ReposGetOctokit {
	readonly rest: {
		readonly repos: {
			readonly get: (args: { owner: string; repo: string }) => Promise<{ data: { default_branch: string } }>;
		};
	};
}

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

/** Resolve the base branch: the input when set, else the repo's default branch. */
export const resolveBaseBranch = (input: string | null): Effect.Effect<string, GitHubClientError, GitHubClient> =>
	input !== null
		? Effect.succeed(input)
		: Effect.gen(function* () {
				const client = yield* GitHubClient;
				const { owner, repo } = yield* client.repo;
				const { default_branch } = yield* client.rest<{ default_branch: string }>("repos.get", (octokit) =>
					(octokit as ReposGetOctokit).rest.repos.get({ owner, repo }),
				);
				return default_branch;
			});

/** Land the edit per `mode`. Never passes author/committer/signature — commits stay verified. */
export const land = (
	params: LandParams,
): Effect.Effect<
	LandResult,
	GitCommitError | GitBranchError | PullRequestError | GitHubClientError,
	GitCommit | GitBranch | PullRequest | GitHubClient
> =>
	Effect.gen(function* () {
		const commit = yield* GitCommit;
		const client = yield* GitHubClient;
		const { owner, repo } = yield* client.repo;
		const files = [{ path: MANIFEST_PATH, content: params.change.editedText }];
		const commitUrl = (sha: string): string => `https://github.com/${owner}/${repo}/commit/${sha}`;

		if (params.mode === "commit") {
			const sha = yield* commit.commitFiles(params.base, params.commitMessage, files);
			return { commitSha: sha, commitUrl: commitUrl(sha), prNumber: null, prUrl: null };
		}

		const branch = yield* GitBranch;
		const pulls = yield* PullRequest;

		// Every pr-mode run roots the head branch at base's CURRENT tip. The text
		// being committed was computed from the checkout (base), so committing it
		// onto a branch left over from an earlier run would stack a commit on a
		// stale base — and since `branch` defaults to a fixed name reused run over
		// run, the branch drifts until the PR is unmergeable. Resetting keeps each
		// run's PR a clean one-commit diff against base. The reset cannot produce
		// an empty diff: `land` is only reached once the no-op guard has proven the
		// edit differs from base.
		const baseSha = yield* branch.getSha(params.base);
		const branchExists = yield* branch.exists(params.branch);
		if (branchExists) {
			yield* Effect.logInfo(
				`Step: land — reset ${params.branch} onto ${params.base}@${baseSha.slice(0, 7)} (discarding any earlier run's commits)`,
			);
			yield* branch.reset(params.branch, baseSha);
		} else {
			// TOCTOU: another concurrent run can create this branch between the
			// `exists` check above and this `create` call. The library's
			// GitBranchError carries no structured "already exists" discriminant
			// (just a free-form `reason` string), so re-checking existence after a
			// failure — rather than string-matching the message — is the robust
			// way to tell "someone else already created it" from a real failure.
			// The recovery resets rather than merely proceeding, so a concurrent
			// creator that rooted the branch elsewhere is corrected, not inherited.
			yield* branch
				.create(params.branch, baseSha)
				.pipe(
					Effect.catchTag("GitBranchError", (error) =>
						Effect.flatMap(branch.exists(params.branch), (existsNow) =>
							existsNow ? branch.reset(params.branch, baseSha) : Effect.fail(error),
						),
					),
				);
		}

		const sha = yield* commit.commitFiles(params.branch, params.commitMessage, files);
		const pr = yield* pulls.getOrCreate({
			head: params.branch,
			base: params.base,
			title: params.prTitle,
			body: params.prBody,
			autoMerge: params.autoMerge,
		});
		return { commitSha: sha, commitUrl: commitUrl(sha), prNumber: pr.number, prUrl: pr.url };
	});
