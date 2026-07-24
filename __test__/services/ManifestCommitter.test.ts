import { assert, describe, it } from "@effect/vitest";
import {
	GitBranchTest,
	GitCommitTest,
	GitHubClientTest,
	PullRequestTest,
} from "@savvy-web/github-action-effects/testing";
import { Effect, Layer } from "effect";
import { land } from "../../src/services/ManifestCommitter.js";

const params = {
	base: "main",
	branch: "chore/repin-plugins",
	editedText: "{}\n",
	commitMessage: "ai(marketplace): repinned p@acme",
	prTitle: "ai(marketplace): repinned p@acme",
	prBody: "- pinned p@acme to abc",
	autoMerge: "rebase" as const,
};

describe("land", () => {
	it.effect("commit mode commits directly to base and opens no PR", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const branch = GitBranchTest.empty();
			const pr = PullRequestTest.empty();
			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				GitBranchTest.layer(branch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const result = yield* land({ mode: "commit", ...params }).pipe(Effect.provide(layer));
			assert.deepStrictEqual(
				commit.refUpdates.map((r) => r.ref),
				["main"],
			);
			assert.strictEqual(commit.commits[0]?.message, params.commitMessage);
			assert.strictEqual(result.commitSha, commit.commits[0]?.sha);
			assert.strictEqual(result.commitUrl, `https://github.com/test-owner/test-repo/commit/${result.commitSha}`);
			assert.isNull(result.prNumber);
			assert.lengthOf(pr.prs, 0);
		}),
	);

	it.effect("pr mode creates the branch, commits to it, and opens a PR", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const branch = GitBranchTest.empty();
			branch.branches.set("main", "base-sha");
			const pr = PullRequestTest.empty();
			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				GitBranchTest.layer(branch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const result = yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			assert.isTrue(branch.branches.has("chore/repin-plugins"));
			assert.deepStrictEqual(
				commit.refUpdates.map((r) => r.ref),
				["chore/repin-plugins"],
			);
			assert.strictEqual(result.commitUrl, `https://github.com/test-owner/test-repo/commit/${result.commitSha}`);
			assert.isNotNull(result.prNumber);
			assert.lengthOf(pr.prs, 1);
			assert.strictEqual(pr.prs[0]?.autoMerge, "rebase");
		}),
	);

	it.effect("passes the requested auto-merge method through to an existing PR too", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const branch = GitBranchTest.empty();
			branch.branches.set("main", "base-sha");
			const pr = PullRequestTest.empty();
			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				GitBranchTest.layer(branch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			yield* land({ mode: "pr", ...params, autoMerge: "squash" }).pipe(Effect.provide(layer));
			assert.strictEqual(pr.prs[0]?.autoMerge, "squash");

			// Re-land against the SAME open PR with a different method — getOrCreate's
			// update path must re-apply auto-merge too, not just the create path.
			yield* land({ mode: "pr", ...params, autoMerge: "merge" }).pipe(Effect.provide(layer));
			assert.lengthOf(pr.prs, 1);
			assert.strictEqual(pr.prs[0]?.autoMerge, "merge");
		}),
	);
});
