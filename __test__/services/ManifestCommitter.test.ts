import { assert, describe, it } from "@effect/vitest";
import {
	GitBranch,
	GitBranchError,
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
			// The branch is created from base's sha, not an arbitrary/incorrect ref.
			assert.strictEqual(branch.branches.get("chore/repin-plugins"), "base-sha");
			// Exactly one commit is written, to the head branch.
			assert.lengthOf(commit.commits, 1);
			assert.deepStrictEqual(
				commit.refUpdates.map((r) => r.ref),
				["chore/repin-plugins"],
			);
			assert.strictEqual(result.commitUrl, `https://github.com/test-owner/test-repo/commit/${result.commitSha}`);
			assert.isNotNull(result.prNumber);
			assert.lengthOf(pr.prs, 1);
			// The recorded PR uses the expected base, head, title, and body — not
			// just "a PR exists somewhere".
			assert.strictEqual(pr.prs[0]?.base, params.base);
			assert.strictEqual(pr.prs[0]?.head, params.branch);
			assert.strictEqual(pr.prs[0]?.title, params.prTitle);
			assert.strictEqual(pr.prs[0]?.body, params.prBody);
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

	it.effect("recovers when branch.create races with a concurrent creator", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const pr = PullRequestTest.empty();

			// Simulates another run creating the same branch between this run's
			// `exists` check and its own `create` call: the first `exists` check
			// (before create) sees it absent, `create` fails as if the ref already
			// existed, and the re-check inside `land`'s recovery path must see it
			// now present and proceed rather than propagating the error.
			let concurrentlyCreated = false;
			const racyBranch: typeof GitBranch.Service = {
				create: (name) =>
					Effect.sync(() => {
						concurrentlyCreated = true;
					}).pipe(
						Effect.flatMap(() =>
							Effect.fail(
								new GitBranchError({ branch: name, operation: "create", reason: "Reference already exists" }),
							),
						),
					),
				exists: (name) => Effect.succeed(name === params.base || concurrentlyCreated),
				getSha: () => Effect.succeed("base-sha"),
				delete: () => Effect.void,
				reset: () => Effect.void,
			};

			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				Layer.succeed(GitBranch, racyBranch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const result = yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			assert.isTrue(concurrentlyCreated);
			assert.isNotNull(result.prNumber);
			assert.lengthOf(pr.prs, 1);
		}),
	);

	it.effect("still fails when branch.create fails for a reason other than a concurrent create", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const pr = PullRequestTest.empty();

			// The branch genuinely never gets created (a real API failure, not a
			// race) — `exists` stays false on the recovery re-check too, so the
			// original error must still propagate rather than being swallowed.
			const brokenBranch: typeof GitBranch.Service = {
				create: (name) =>
					Effect.fail(new GitBranchError({ branch: name, operation: "create", reason: "insufficient permissions" })),
				exists: (name) => Effect.succeed(name === params.base),
				getSha: () => Effect.succeed("base-sha"),
				delete: () => Effect.void,
				reset: () => Effect.void,
			};

			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				Layer.succeed(GitBranch, brokenBranch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const error = yield* Effect.flip(land({ mode: "pr", ...params }).pipe(Effect.provide(layer)));
			assert.strictEqual(error._tag, "GitBranchError");
			assert.lengthOf(pr.prs, 0);
		}),
	);
});
