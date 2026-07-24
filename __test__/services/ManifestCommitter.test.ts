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
import { MANIFEST_PATH } from "../../src/services/ManifestEditor.js";
import { validateEdit } from "../../src/services/ManifestValidator.js";

const ORIGINAL = `{
	"name": "acme",
	"owner": { "name": "acme" },
	"plugins": [
		{ "name": "p1", "source": { "source": "git-subdir", "url": "https://github.com/acme/p1", "path": "plugin", "sha": "${"0".repeat(40)}" } }
	]
}
`;
const EDITED = ORIGINAL.replace("0".repeat(40), "1".repeat(40));

// `land` accepts only a validator-minted ValidatedManifestChange, so the fixture
// is minted through the real `validateEdit` rather than cast into place. A
// fixture that stopped validating throws here instead of silently weakening
// every test below.
const change = Effect.runSync(
	validateEdit(
		{
			original: ORIGINAL,
			editedText: EDITED,
			changed: true,
			manifestName: "acme",
			changes: [{ pluginName: "p1", manifestName: "acme", field: "sha", value: "1".repeat(40) }],
		},
		["p1"],
	),
);

const params = {
	base: "main",
	branch: "chore/repin-plugins",
	change,
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
			// The validated change's text is what actually reaches the tree, at the
			// manifest path — not the original, and not some other field.
			assert.deepStrictEqual(commit.trees[0]?.entries, [{ path: MANIFEST_PATH, mode: "100644", content: EDITED }]);
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

	it.effect("pr mode resets an existing branch onto base before committing", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const branch = GitBranchTest.empty();
			// A long-lived head branch left over from an earlier run, now behind a
			// base that has moved on — the drift that made spencerbeggs/bot#12
			// unmergeable (issue #3).
			branch.branches.set("main", "base-sha-2");
			branch.branches.set("chore/repin-plugins", "drifted-sha");
			const pr = PullRequestTest.empty();
			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				GitBranchTest.layer(branch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const result = yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			// The stale tip is discarded: the branch is re-rooted at base's CURRENT
			// sha rather than having a commit stacked onto `drifted-sha`.
			assert.strictEqual(branch.branches.get("chore/repin-plugins"), "base-sha-2");
			// Still exactly one commit, still to the head branch.
			assert.lengthOf(commit.commits, 1);
			assert.deepStrictEqual(
				commit.refUpdates.map((r) => r.ref),
				["chore/repin-plugins"],
			);
			assert.isNotNull(result.prNumber);
			assert.lengthOf(pr.prs, 1);
		}),
	);

	it.effect("re-landing against the same PR re-roots the branch at the current base", () =>
		Effect.gen(function* () {
			const commit = GitCommitTest.empty();
			const branch = GitBranchTest.empty();
			branch.branches.set("main", "base-sha-1");
			const pr = PullRequestTest.empty();
			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				GitBranchTest.layer(branch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);

			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			assert.strictEqual(branch.branches.get("chore/repin-plugins"), "base-sha-1");

			// Base moves on (another PR merged), then the action runs again against
			// the same fixed branch name. The second run must follow base rather
			// than append to the first run's commit.
			branch.branches.set("main", "base-sha-2");
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			assert.strictEqual(branch.branches.get("chore/repin-plugins"), "base-sha-2");
			// One commit per run — but each rooted at base, not stacked.
			assert.lengthOf(commit.commits, 2);
			// And still a single PR for the head→base pair.
			assert.lengthOf(pr.prs, 1);
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
			const resets: Array<{ name: string; sha: string }> = [];
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
				reset: (name, sha) =>
					Effect.sync(() => {
						resets.push({ name, sha });
					}),
			};

			const layer = Layer.mergeAll(
				GitCommitTest.layer(commit),
				Layer.succeed(GitBranch, racyBranch),
				PullRequestTest.layer(pr),
				GitHubClientTest.empty(),
			);
			const result = yield* land({ mode: "pr", ...params }).pipe(Effect.provide(layer));
			assert.isTrue(concurrentlyCreated);
			// The recovery path doesn't just proceed on the winner's branch — it
			// re-roots it at base, so a concurrent creator that rooted the branch
			// somewhere else is corrected rather than inherited.
			assert.deepStrictEqual(resets, [{ name: params.branch, sha: "base-sha" }]);
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

describe("land type boundary", () => {
	it("rejects unvalidated and byte-stable input at compile time", () => {
		// This closure is never invoked: the assertions ARE the @ts-expect-error
		// directives, checked by `tsc --noEmit` (pnpm typecheck, and the
		// pre-commit hook, both of which include __test__). If `land` or
		// `validateEdit` ever accepted these shapes again, the directives become
		// unused and typecheck fails. That compile-time rejection is the whole
		// point of issue #2 — a runtime test cannot express it.
		const rejected = () => {
			// @ts-expect-error raw manifest text is not proof of validation
			void land({ mode: "commit", ...params, change: EDITED });
			// @ts-expect-error an unbranded { editedText, changes } is not proof either
			void land({ mode: "commit", ...params, change: { editedText: EDITED, changes: [] } });
			void validateEdit(
				// @ts-expect-error a byte-stable NoopEdit can never be certified
				{ original: ORIGINAL, editedText: ORIGINAL, changed: false, manifestName: "acme", changes: [] },
				["p1"],
			);
		};
		assert.isFunction(rejected);
	});
});
