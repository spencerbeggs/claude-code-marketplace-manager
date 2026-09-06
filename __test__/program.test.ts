import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { GitBranch, GitCommit, GitHubRepository, PullRequest, Repo, RepoRef } from "@effected/github";
import { ActionInput, ActionOutputs, ActionState } from "@effected/github-actions";
import { Cause, ConfigProvider, Effect, Exit, Layer, Schema } from "effect";
import { program } from "../src/program.js";

// The bundled marketplace.json schema requires `owner` at the top level.
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

/**
 * Run `program` against fixture inputs and a fixture checkout.
 *
 * The landing services are provided as **bare `layerTest()` doubles with no
 * overrides**, which is the assertion: every unstubbed member dies naming
 * itself. So "no-op and dry-run must not land" is enforced by the doubles
 * themselves rather than by counting recorded calls afterward — any commit,
 * branch or PR call at all fails the test loudly. `ActionState` is bare for the
 * same reason: reaching it would mean `GitHubToken.botIdentity()` ran, which
 * only happens past the dry-run guard.
 */
const withProgram = (inputs: Record<string, string>, dir: string) => {
	const recorded: Array<{ readonly name: string; readonly value: string }> = [];
	const summaries: Array<string> = [];

	const layer = Layer.mergeAll(
		ActionOutputs.layerTest({
			set: (name, value) =>
				Effect.sync(() => {
					recorded.push({ name, value });
				}),
			// This double MUST encode through `schema`, exactly as the real
			// `setJson` does (ActionOutputs.ts:196). A double that accepts the
			// schema and ignores it makes every assertion below structurally
			// incapable of catching a projection/schema drift: the real
			// implementation would fail to encode, `program.ts` would swallow that
			// into a `logWarning`, and the machine-readable `result` output would
			// silently vanish in production with this suite green.
			//
			// `orDie` rather than a typed failure is deliberate, and is the one
			// place this double is stricter than production. Production degrades
			// gracefully — losing `result` should not fail a run that already did
			// its work. In a test the same event is a contract bug, and it has to
			// be loud, so it is raised as a defect that no `Effect.catch` in
			// `program.ts` will absorb.
			setJson: (name, value, schema) =>
				Schema.encodeUnknownEffect(schema)(value).pipe(
					Effect.orDie,
					Effect.flatMap((encoded) =>
						Effect.sync(() => {
							recorded.push({ name, value: JSON.stringify(encoded) });
						}),
					),
				),
			summary: (content) =>
				Effect.sync(() => {
					summaries.push(content);
				}),
		}),
		ActionState.layerTest(),
		GitCommit.layerTest(),
		GitBranch.layerTest(),
		PullRequest.layerTest(),
		GitHubRepository.layerTest(),
		Layer.succeed(Repo, RepoRef.make({ owner: "test-owner", repo: "test-repo" })),
		NodeFileSystem.layer,
	);

	const cwd = process.cwd();
	const run = Effect.gen(function* () {
		process.chdir(dir);
		return yield* program;
	}).pipe(
		Effect.ensuring(Effect.sync(() => process.chdir(cwd))),
		Effect.provide(layer),
		// `ActionInput.provider`, never `ConfigProvider.fromEnv`/`fromUnknown`:
		// `parseInputs` reads through `ActionInput.string`, which resolves
		// `INPUT_*`, so a provider keyed by bare input name would serve nothing and
		// every read would silently take its default.
		Effect.provide(ConfigProvider.layer(ActionInput.provider(inputs))),
	);

	return { run, recorded, summaries };
};

const outputValue = (recorded: ReadonlyArray<{ name: string; value: string }>, name: string) =>
	recorded.find((o) => o.name === name)?.value;

describe("program", () => {
	it.effect("dry-run emits a result and never lands", () =>
		Effect.gen(function* () {
			const h = withProgram({ name: "p1", sha: "1".repeat(40), "dry-run": "true", "base-branch": "main" }, setup());
			yield* h.run;

			assert.strictEqual(outputValue(h.recorded, "status"), "success");
			assert.strictEqual(outputValue(h.recorded, "changed"), "true");
			assert.strictEqual(outputValue(h.recorded, "plugins-updated"), "1");
			assert.isDefined(outputValue(h.recorded, "result"));
			// Nothing landed: the commit/branch/PR doubles would have died.
			assert.strictEqual(outputValue(h.recorded, "commit-sha"), "");
			assert.strictEqual(outputValue(h.recorded, "pr-number"), "");
			assert.lengthOf(h.summaries, 1);
		}),
	);

	it.effect("a no-op edit reports status no-op, changed false, and skips validation and landing", () =>
		Effect.gen(function* () {
			// Patching p1 to the sha it already has is byte-stable.
			const h = withProgram({ name: "p1", sha: "0".repeat(40), "base-branch": "main" }, setup());
			yield* h.run;

			assert.strictEqual(outputValue(h.recorded, "status"), "no-op");
			assert.strictEqual(outputValue(h.recorded, "changed"), "false");
			assert.strictEqual(outputValue(h.recorded, "plugins-updated"), "0");
			assert.strictEqual(outputValue(h.recorded, "commit-sha"), "");
		}),
	);

	it.effect("every terminal path emits a result output", () =>
		Effect.gen(function* () {
			const noop = withProgram({ name: "p1", sha: "0".repeat(40), "base-branch": "main" }, setup());
			yield* noop.run;
			assert.isDefined(outputValue(noop.recorded, "result"));

			const dry = withProgram({ name: "p1", sha: "1".repeat(40), "dry-run": "true", "base-branch": "main" }, setup());
			yield* dry.run;
			assert.isDefined(outputValue(dry.recorded, "result"));
		}),
	);

	it.effect("a validation failure emits a failed result AND the program still fails", () =>
		Effect.gen(function* () {
			// A plugin name that is not in the manifest fails with PluginNotFoundError.
			const h = withProgram({ name: "nope", sha: "1".repeat(40), "base-branch": "main" }, setup());
			const exit = yield* Effect.exit(h.run);

			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(outputValue(h.recorded, "status"), "failed");
			assert.strictEqual(outputValue(h.recorded, "changed"), "false");
			const result = outputValue(h.recorded, "result");
			assert.isDefined(result);
			const parsed = JSON.parse(String(result)) as { succeeded: boolean; hasFailures: boolean };
			assert.isFalse(parsed.succeeded);
			assert.isTrue(parsed.hasFailures);
		}),
	);

	it.effect("an input failure emits a failed result before re-raising", () =>
		Effect.gen(function* () {
			// Neither manual nor json — parseInputs fails before orchestration starts.
			const h = withProgram({}, setup());
			const exit = yield* Effect.exit(h.run);

			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(outputValue(h.recorded, "status"), "failed");
			// The fallback shape for an unparsed input set.
			assert.strictEqual(outputValue(h.recorded, "mode"), "commit");
			// The structured `result` is the contract downstream consumers read,
			// so assert it directly: checking only the scalars would still pass if
			// failure reporting stopped emitting `result` altogether.
			const result = outputValue(h.recorded, "result");
			assert.isString(result);
			const parsed: unknown = JSON.parse(result as string);
			assert.deepInclude(parsed, { status: "failed", hasFailures: true });
		}),
	);

	// Failure reporting runs before the real cause is re-raised, so an output
	// write that fails while reporting must not become the reason the run
	// failed. Fault-inject `set` so every scalar write fails, then assert the
	// domain error still arrives: without the `catchCause` in `emitFailure` the
	// `yield*` short-circuits and this surfaces the output error instead.
	it.effect("an output-write failure while reporting does not displace the real cause", () =>
		Effect.gen(function* () {
			const dir = setup();
			const layer = Layer.mergeAll(
				ActionOutputs.layerTest({
					set: () => Effect.die(new Error("GITHUB_OUTPUT is gone")),
					setJson: () => Effect.die(new Error("GITHUB_OUTPUT is gone")),
					summary: () => Effect.void,
				}),
				ActionState.layerTest(),
				GitCommit.layerTest(),
				GitBranch.layerTest(),
				PullRequest.layerTest(),
				GitHubRepository.layerTest(),
				Layer.succeed(Repo, RepoRef.make({ owner: "test-owner", repo: "test-repo" })),
				NodeFileSystem.layer,
			);

			const cwd = process.cwd();
			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					process.chdir(dir);
					return yield* program;
				}).pipe(
					Effect.ensuring(Effect.sync(() => process.chdir(cwd))),
					Effect.provide(layer),
					Effect.provide(
						ConfigProvider.layer(ActionInput.provider({ name: "nope", sha: "1".repeat(40), "base-branch": "main" })),
					),
				),
			);

			assert.isTrue(Exit.isFailure(exit));
			const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";
			// The domain failure is the missing plugin, not the output writer.
			assert.include(rendered, "nope");
			assert.notInclude(rendered, "GITHUB_OUTPUT is gone");
		}),
	);
});
