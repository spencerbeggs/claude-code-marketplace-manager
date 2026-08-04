import { assert, describe, it } from "@effect/vitest";
import type { PullRequestInfo as PullRequestInfoType } from "@effected/github";
import { GitBranch, GitCommit, PullRequest, PullRequestInfo, Repo, RepoRef } from "@effected/github";
import { Effect, Layer, Option } from "effect";
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
	commitMessage: "ai(marketplace): repinned p1@acme",
	prTitle: "ai(marketplace): repinned p1@acme",
	prBody: "- pinned p1@acme to 1111111",
	autoMerge: "rebase" as const,
};

const repoLayer = Layer.succeed(Repo, RepoRef.make({ owner: "test-owner", repo: "test-repo" }));

/**
 * A recording harness over the kit's `layerTest` doubles.
 *
 * `layerTest(overrides)` dies naming any member the code under test touches but
 * the test did not stub, so this arranges exactly the members `land` is
 * expected to use — which makes an unexpected extra call a loud failure rather
 * than a silently-served default. `branches` seeds the refs that already exist.
 */
const harness = (branches: Record<string, string> = {}) => {
	const refs = new Map<string, string>(Object.entries(branches));
	const calls: Array<string> = [];
	const trees: Array<{ readonly baseTree: string | undefined; readonly paths: ReadonlyArray<string> }> = [];
	const commits: Array<{ readonly message: string; readonly tree: string; readonly parents: ReadonlyArray<string> }> =
		[];
	const contents: Array<string> = [];
	const commitFileCalls: Array<{ readonly branch: string; readonly message: string }> = [];
	const upserts: Array<{ readonly name: string; readonly sha: string }> = [];
	const prUpserts: Array<{
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}> = [];
	const autoMerges: Array<string> = [];

	const info: PullRequestInfoType = PullRequestInfo.make({
		number: 42,
		nodeId: "PR_node",
		url: "https://github.com/test-owner/test-repo/pull/42",
		title: params.prTitle,
		state: "open",
		head: params.branch,
		headSha: "head-sha",
		base: params.base,
		baseSha: "base-sha",
		draft: false,
		merged: false,
		mergedAt: Option.none(),
	});

	const layer = Layer.mergeAll(
		GitCommit.layerTest({
			get: (sha) => {
				calls.push("commit.get");
				return Effect.succeed({ sha, treeSha: `tree-of-${sha}`, parents: [] });
			},
			createTree: ({ changes, baseTree }) => {
				calls.push("commit.createTree");
				trees.push({ baseTree, paths: changes.map((c) => c.path) });
				for (const c of changes) {
					if (c._tag === "FileContent") {
						contents.push(c.content);
					}
				}
				return Effect.succeed("new-tree");
			},
			createCommit: ({ message, tree, parents }) => {
				calls.push("commit.createCommit");
				commits.push({ message, tree, parents });
				return Effect.succeed("new-commit-sha");
			},
			commitFiles: ({ branch, message, changes }) => {
				calls.push("commit.commitFiles");
				commitFileCalls.push({ branch, message });
				for (const c of changes) {
					if (c._tag === "FileContent") {
						contents.push(c.content);
					}
				}
				return Effect.succeed("direct-commit-sha");
			},
		}),
		GitBranch.layerTest({
			sha: (name) => {
				calls.push("branch.sha");
				return Effect.succeed(refs.get(name) ?? "base-sha");
			},
			upsert: (name, sha) => {
				calls.push("branch.upsert");
				upserts.push({ name, sha });
				const existed = refs.has(name);
				refs.set(name, sha);
				return Effect.succeed(existed ? "reset" : "created");
			},
		}),
		PullRequest.layerTest({
			upsert: (input) => {
				calls.push("pulls.upsert");
				prUpserts.push(input);
				return Effect.succeed({ pullRequest: info, created: true });
			},
			setAutoMerge: (_pr, method) => {
				calls.push("pulls.setAutoMerge");
				autoMerges.push(method);
				return Effect.void;
			},
		}),
		repoLayer,
	);

	return { layer, refs, calls, trees, commits, contents, commitFileCalls, upserts, prUpserts, autoMerges };
};

describe("land", () => {
	it.effect("commit mode commits directly to base and opens no PR", () =>
		Effect.gen(function* () {
			const h = harness();
			const result = yield* land({ mode: "commit", ...params }).pipe(Effect.provide(h.layer));

			assert.deepStrictEqual(h.commitFileCalls, [{ branch: "main", message: params.commitMessage }]);
			// The validated change's text is what reaches the tree, at the manifest
			// path — not the original, and not some other field.
			assert.deepStrictEqual(h.contents, [EDITED]);
			assert.strictEqual(result.commitSha, "direct-commit-sha");
			assert.strictEqual(result.commitUrl, "https://github.com/test-owner/test-repo/commit/direct-commit-sha");
			assert.isNull(result.prNumber);
			assert.isNull(result.prUrl);
			// No branch or PR machinery is touched at all in commit mode.
			assert.deepStrictEqual(h.calls, ["commit.commitFiles"]);
		}),
	);

	it.effect("commit mode writes the manifest at the expected path", () =>
		Effect.gen(function* () {
			const h = harness();
			yield* land({ mode: "commit", ...params }).pipe(Effect.provide(h.layer));
			assert.strictEqual(MANIFEST_PATH, ".claude-plugin/marketplace.json");
			assert.deepStrictEqual(h.contents, [EDITED]);
		}),
	);

	it.effect("pr mode builds the commit against base, then moves the ref once", () =>
		Effect.gen(function* () {
			const h = harness({ main: "base-sha" });
			const result = yield* land({ mode: "pr", ...params }).pipe(Effect.provide(h.layer));

			// Ruling D-2: the commit is fully built BEFORE the head ref moves, so the
			// branch never rests on the bare base head. Reversing these two — the
			// obvious `upsert(branch, baseSha)` then `commitFiles` spelling — is what
			// makes an open PR briefly empty and gets it auto-closed by GitHub.
			assert.deepStrictEqual(h.calls, [
				"branch.sha",
				"commit.get",
				"commit.createTree",
				"commit.createCommit",
				"branch.upsert",
				"pulls.upsert",
				"pulls.setAutoMerge",
			]);
			// Exactly one ref move, and it lands on the finished commit — never on
			// the base sha.
			assert.deepStrictEqual(h.upserts, [{ name: params.branch, sha: "new-commit-sha" }]);
			assert.notStrictEqual(h.upserts[0]?.sha, "base-sha");
			// The commit is rooted at base's current tip.
			assert.deepStrictEqual(h.commits, [{ message: params.commitMessage, tree: "new-tree", parents: ["base-sha"] }]);
			assert.deepStrictEqual(h.trees, [{ baseTree: "tree-of-base-sha", paths: [MANIFEST_PATH] }]);
			assert.deepStrictEqual(h.contents, [EDITED]);

			assert.strictEqual(result.commitSha, "new-commit-sha");
			assert.strictEqual(result.commitUrl, "https://github.com/test-owner/test-repo/commit/new-commit-sha");
			assert.strictEqual(result.prNumber, 42);
			assert.strictEqual(result.prUrl, "https://github.com/test-owner/test-repo/pull/42");
		}),
	);

	it.effect("pr mode opens the PR with the expected head, base, title and body", () =>
		Effect.gen(function* () {
			const h = harness({ main: "base-sha" });
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(h.layer));
			assert.deepStrictEqual(h.prUpserts, [
				{ title: params.prTitle, head: params.branch, base: params.base, body: params.prBody },
			]);
		}),
	);

	it.effect("passes the requested auto-merge method through", () =>
		Effect.gen(function* () {
			const h = harness({ main: "base-sha" });
			yield* land({ mode: "pr", ...params, autoMerge: "squash" }).pipe(Effect.provide(h.layer));
			// A non-default method on purpose: asserting "rebase" would pass against
			// an implementation that ignored the parameter entirely.
			assert.deepStrictEqual(h.autoMerges, ["squash"]);
		}),
	);

	// ---------------------------------------------------------------------
	// Invariant B5 — the pr-mode head branch is force-reset onto base every
	// run. Under ruling D-2 the reset is implicit inside the single `upsert`,
	// which is exactly the shape in which an invariant quietly loses its test
	// coverage during a refactor. These two pin it directly.
	// ---------------------------------------------------------------------

	it.effect("B5: a stale head branch is re-rooted at base's CURRENT tip, not stacked onto", () =>
		Effect.gen(function* () {
			// A long-lived head branch left over from an earlier run, now behind a
			// base that has moved on — the drift that made spencerbeggs/bot#12
			// unmergeable.
			const h = harness({ main: "base-sha-2", "chore/repin-plugins": "drifted-sha" });
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(h.layer));

			// The new commit's parent is base's current tip — NOT the drifted tip.
			// If the implementation regressed to stacking onto the existing branch,
			// parents would be ["drifted-sha"] and this fails.
			assert.deepStrictEqual(h.commits[0]?.parents, ["base-sha-2"]);
			assert.notInclude(h.commits[0]?.parents ?? [], "drifted-sha");
			// The stale tip is discarded outright.
			assert.strictEqual(h.refs.get("chore/repin-plugins"), "new-commit-sha");
			// Still exactly one commit and one ref move.
			assert.lengthOf(h.commits, 1);
			assert.lengthOf(h.upserts, 1);
		}),
	);

	it.effect("B5: a second run discards the first run's commit rather than stacking on it", () =>
		Effect.gen(function* () {
			// Run one against a fresh repo.
			const first = harness({ main: "base-sha" });
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(first.layer));
			assert.strictEqual(first.refs.get("chore/repin-plugins"), "new-commit-sha");

			// Run two, with the branch now carrying run one's commit and base
			// unchanged. The head branch must be re-rooted at base, so the second
			// commit's parent is base — never run one's commit.
			const second = harness({ main: "base-sha", "chore/repin-plugins": "new-commit-sha" });
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(second.layer));

			assert.deepStrictEqual(second.commits[0]?.parents, ["base-sha"]);
			assert.notInclude(second.commits[0]?.parents ?? [], "new-commit-sha");
			// One commit per run — the branch is never a growing stack.
			assert.lengthOf(second.commits, 1);
		}),
	);

	it.effect("B1: never passes an author, committer or signature field", () =>
		Effect.gen(function* () {
			// Structural, and deliberately so: `GitCommit` exposes no author,
			// committer or signature parameter, so the only thing a caller COULD
			// pass is the message. This asserts the surface rather than a value —
			// if the kit ever grew such a parameter, the object below would gain a
			// key and this fails, which is the moment to re-read verified-commits.md.
			const h = harness({ main: "base-sha" });
			yield* land({ mode: "pr", ...params }).pipe(Effect.provide(h.layer));
			assert.deepStrictEqual(Object.keys(h.commits[0] ?? {}).sort(), ["message", "parents", "tree"]);
			// The bot identity reaches the commit only as message text.
			assert.strictEqual(h.commits[0]?.message, params.commitMessage);
		}),
	);
});
