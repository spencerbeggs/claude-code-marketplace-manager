import type {
	GitBranchError,
	GitCommitError,
	GitHubClientError,
	PullRequestError,
} from "@savvy-web/github-action-effects";
import { GitBranch, GitCommit, GitHubClient, PullRequest } from "@savvy-web/github-action-effects";
import { Effect } from "effect";
import { MANIFEST_PATH } from "./ManifestEditor.js";

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
	readonly editedText: string;
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
		const files = [{ path: MANIFEST_PATH, content: params.editedText }];
		const commitUrl = (sha: string): string => `https://github.com/${owner}/${repo}/commit/${sha}`;

		if (params.mode === "commit") {
			const sha = yield* commit.commitFiles(params.base, params.commitMessage, files);
			return { commitSha: sha, commitUrl: commitUrl(sha), prNumber: null, prUrl: null };
		}

		const branch = yield* GitBranch;
		const pulls = yield* PullRequest;

		const branchExists = yield* branch.exists(params.branch);
		if (!branchExists) {
			const baseSha = yield* branch.getSha(params.base);
			yield* branch.create(params.branch, baseSha);
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
