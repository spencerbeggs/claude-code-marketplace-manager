import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type {
	ActionOutputsTestState,
	GitBranchTestState,
	GitCommitTestState,
	PullRequestTestState,
} from "@savvy-web/github-action-effects/testing";
import {
	ActionEnvironmentTest,
	ActionLoggerTest,
	ActionOutputsTest,
	ActionStateTest,
	GitBranchTest,
	GitCommitTest,
	GitHubClientTest,
	PullRequestTest,
} from "@savvy-web/github-action-effects/testing";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { program } from "../src/program.js";

// The bundled marketplace.json schema (task-1/task-8) requires `owner` at the
// top level — the brief's fixture omitted it, which fails `validateManifest`'s
// ajv structural check on the dry-run path. Adapted here.
const MANIFEST = `{
	"name": "acme",
	"owner": { "name": "Acme" },
	"plugins": [
		{ "name": "p1", "source": { "source": "git-subdir", "url": "https://github.com/acme/p1", "path": "plugin", "sha": "${"0".repeat(40)}" } }
	]
}
`;

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), "mm-"));
	mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
	writeFileSync(join(dir, ".claude-plugin/marketplace.json"), MANIFEST);
	return dir;
};

/** The commit/branch/PR test state a run exercised — used to assert no landing activity occurred. */
interface LandingState {
	readonly commit: GitCommitTestState;
	readonly branch: GitBranchTestState;
	readonly pr: PullRequestTestState;
}

const emptyLandingState = (): LandingState => ({
	commit: GitCommitTest.empty(),
	branch: GitBranchTest.empty(),
	pr: PullRequestTest.empty(),
});

/**
 * Run `program` against fixture inputs/cwd, restoring cwd once the effect
 * completes (success or failure). Accepts the commit/branch/PR test state so
 * callers can assert on landing activity (or its absence) afterward.
 */
const withProgram = (
	inputs: Record<string, string>,
	outputs: ActionOutputsTestState,
	dir: string,
	landing: LandingState = emptyLandingState(),
) => {
	const layer = Layer.mergeAll(
		ActionLoggerTest.layer(ActionLoggerTest.empty()),
		ActionOutputsTest.layer(outputs),
		ActionEnvironmentTest.empty(), // returns a Layer directly (ActionEnvironmentTest.ts:137)
		ActionStateTest.layer(ActionStateTest.empty()),
		GitCommitTest.layer(landing.commit),
		GitBranchTest.layer(landing.branch),
		PullRequestTest.layer(landing.pr),
		// `program`'s R type includes GitHubClient (resolveBaseBranch is called
		// unconditionally in the function body, even though these two tests never
		// reach it at runtime because base-branch is always supplied). Provide the
		// empty test client so the type checks; nothing in it is exercised.
		GitHubClientTest.empty(),
		NodeFileSystem.layer,
	);
	const config = ConfigProvider.fromUnknown(inputs);
	const cwd = process.cwd();
	return Effect.gen(function* () {
		process.chdir(dir);
		return yield* program;
	}).pipe(
		Effect.ensuring(Effect.sync(() => process.chdir(cwd))),
		Effect.provide(layer),
		Effect.provide(ConfigProvider.layer(config)),
	);
};

describe("program", () => {
	it.effect("dry-run emits a result and makes no commit", () =>
		Effect.gen(function* () {
			const outputs = ActionOutputsTest.empty();
			const dir = setup();
			const landing = emptyLandingState();
			yield* withProgram(
				{ name: "p1", sha: "1".repeat(40), "dry-run": "true", "base-branch": "main" },
				outputs,
				dir,
				landing,
			);
			const status = outputs.outputs.find((o) => o.name === "status");
			assert.strictEqual(status?.value, "success");
			assert.strictEqual(outputs.outputs.find((o) => o.name === "changed")?.value, "true");
			assert.isTrue(outputs.outputs.some((o) => o.name === "result"));
			// dry-run must never land: no commits, no ref updates, no branches, no PRs.
			assert.lengthOf(landing.commit.commits, 0);
			assert.lengthOf(landing.commit.refUpdates, 0);
			assert.strictEqual(landing.branch.branches.size, 0);
			assert.lengthOf(landing.pr.prs, 0);
		}),
	);

	it.effect("a no-op edit reports status no-op and changed false", () =>
		Effect.gen(function* () {
			const outputs = ActionOutputsTest.empty();
			const dir = setup();
			const landing = emptyLandingState();
			yield* withProgram({ name: "p1", sha: "0".repeat(40), "base-branch": "main" }, outputs, dir, landing);
			assert.strictEqual(outputs.outputs.find((o) => o.name === "status")?.value, "no-op");
			assert.strictEqual(outputs.outputs.find((o) => o.name === "changed")?.value, "false");
			// no-op must skip validation and landing entirely: no commits, no ref
			// updates, no branches, no PRs.
			assert.lengthOf(landing.commit.commits, 0);
			assert.lengthOf(landing.commit.refUpdates, 0);
			assert.strictEqual(landing.branch.branches.size, 0);
			assert.lengthOf(landing.pr.prs, 0);
		}),
	);

	it.effect("a validation failure emits a failed result and the program still fails", () =>
		Effect.gen(function* () {
			const outputs = ActionOutputsTest.empty();
			const dir = setup();
			const exit = yield* Effect.exit(withProgram({ name: "p1", sha: "zzz", "base-branch": "main" }, outputs, dir));
			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(outputs.outputs.find((o) => o.name === "status")?.value, "failed");
			assert.strictEqual(outputs.outputs.find((o) => o.name === "changed")?.value, "false");
			const result = outputs.outputs.find((o) => o.name === "result");
			assert.isDefined(result);
			const parsed = JSON.parse(String(result?.value)) as { succeeded: boolean; hasFailures: boolean };
			assert.isFalse(parsed.succeeded);
			assert.isTrue(parsed.hasFailures);
		}),
	);
});
