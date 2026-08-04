import { assert, describe, it } from "@effect/vitest";
import { ActionInput } from "@effected/github-actions";
import type { Config } from "effect";
import { ConfigProvider, Effect } from "effect";
import type { InvalidInputError } from "../src/errors/errors.js";
import { parseInputs } from "../src/inputs.js";

const SHA = "1".repeat(40);

/**
 * Inputs are injected through `ActionInput.provider`, which dual-accepts
 * input-name keys (`with:`-block style) and `INPUT_`-spelled ones.
 *
 * Deliberately NOT `ConfigProvider.fromUnknown` (what the pre-port suite used)
 * or `ConfigProvider.fromEnv`. `parseInputs` now reads through
 * `ActionInput.string`, which resolves `INPUT_NAME`; a provider keyed by bare
 * input name never matches it, so every read would fall through to its default
 * and the assertions below would be testing the defaults, not the parse.
 */
const withInputs = (inputs: Record<string, string>) =>
	parseInputs.pipe(Effect.provide(ConfigProvider.layer(ActionInput.provider(inputs))));

/**
 * Narrow `parseInputs`' error union to this action's own tagged error.
 *
 * An assertion function rather than a cast: every failure below must be an
 * `InvalidInputError`, and a `ConfigError` leaking through (a misspelled input
 * name, say) should fail the test loudly instead of being quietly accepted.
 */
function assertInvalidInput(error: Config.ConfigError | InvalidInputError): asserts error is InvalidInputError {
	assert.strictEqual(error._tag, "InvalidInputError");
}

describe("parseInputs", () => {
	it.effect("parses the manual path into a single patch", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: SHA });
			assert.deepStrictEqual(parsed.patches, [{ name: "vitest-agent", sha: SHA }]);
			assert.strictEqual(parsed.mode, "commit");
		}),
	);

	it.effect("reads inputs through the INPUT_ derivation", () =>
		Effect.gen(function* () {
			// The discriminating half of the injection concern: an INPUT_-spelled key
			// must resolve identically. If `parseInputs` regressed to a provider that
			// only served bare names, this fails while the test above still passes.
			const parsed = yield* withInputs({ INPUT_NAME: "vitest-agent", INPUT_SHA: SHA });
			assert.deepStrictEqual(parsed.patches, [{ name: "vitest-agent", sha: SHA }]);
		}),
	);

	it.effect("rejects a manual-path sha that is not 40-hex lowercase", () =>
		Effect.gen(function* () {
			// The manual path decodes through the same schema as the json path, so
			// the sha pattern applies to both equally.
			const error = yield* Effect.flip(withInputs({ name: "vitest-agent", sha: "not-a-sha" }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "name/url/path/sha");
		}),
	);

	it.effect("defaults auto-merge to rebase", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: SHA });
			assert.strictEqual(parsed.autoMerge, "rebase");
		}),
	);

	it.effect("accepts an explicit auto-merge method", () =>
		Effect.gen(function* () {
			// Asserts a NON-default method on purpose: the pre-port suite's
			// "defaults to rebase" test passed against an inert stub that returned
			// `rebase` unconditionally, so only this one proves the input was read.
			const parsed = yield* withInputs({ name: "vitest-agent", sha: SHA, "auto-merge": "squash" });
			assert.strictEqual(parsed.autoMerge, "squash");
		}),
	);

	it.effect("rejects an invalid auto-merge method", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, "auto-merge": "octopus" }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "auto-merge");
		}),
	);

	it.effect("parses the json path into multiple patches", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({
				json: `{"plugins":[{"name":"a","sha":"${SHA}"},{"name":"b","path":"p"}]}`,
			});
			assert.lengthOf(parsed.patches, 2);
		}),
	);

	it.effect("rejects a json input that is a bare array instead of a plugins envelope", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ json: `[{"name":"a","sha":"${SHA}"}]` }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "json");
		}),
	);

	it.effect("rejects json that is not valid JSON at all", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ json: "{not json" }));
			assertInvalidInput(error);
			assert.strictEqual(error.reason, "not valid JSON");
		}),
	);

	it.effect("rejects supplying both manual and json (XOR)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, json: "[]" }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "json");
			assert.strictEqual(error.reason, "provide either the manual fields or json, not both");
		}),
	);

	it.effect("rejects neither manual nor json", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({}));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "name/json");
		}),
	);

	it.effect("rejects name with no field", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a" }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "url/path/sha");
		}),
	);

	it.effect("rejects a url/path/sha with no name", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ sha: SHA }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "name");
		}),
	);

	it.effect("rejects an invalid mode", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, mode: "sideways" }));
			assertInvalidInput(error);
			assert.strictEqual(error.field, "mode");
		}),
	);

	it.effect("carries the non-patch inputs through", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({
				name: "a",
				sha: SHA,
				mode: "pr",
				"base-branch": "release",
				branch: "chore/custom",
				"commit-message": "msg",
				"pr-title": "title",
				"pr-body": "body",
				"dry-run": "true",
			});
			assert.strictEqual(parsed.mode, "pr");
			assert.strictEqual(parsed.baseBranch, "release");
			assert.strictEqual(parsed.branch, "chore/custom");
			assert.strictEqual(parsed.commitMessage, "msg");
			assert.strictEqual(parsed.prTitle, "title");
			assert.strictEqual(parsed.prBody, "body");
			assert.strictEqual(parsed.dryRun, true);
		}),
	);

	it.effect("treats omitted optional inputs as absent, not empty strings", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "a", sha: SHA });
			assert.strictEqual(parsed.baseBranch, null);
			assert.strictEqual(parsed.commitMessage, null);
			assert.strictEqual(parsed.prTitle, null);
			assert.strictEqual(parsed.prBody, null);
			assert.strictEqual(parsed.branch, "chore/repin-plugins");
			assert.strictEqual(parsed.dryRun, false);
		}),
	);

	it.effect("rejects a malformed dry-run rather than silently defaulting it to false", () =>
		Effect.gen(function* () {
			// The failure mode this guards: `dry-run` reaching a boolean read as
			// something like "yes" and being swallowed by the default, so a run
			// the caller believed was a dry run lands a real commit. A malformed
			// value must fail loudly — the default is for ABSENCE, not garbage.
			const error = yield* withInputs({ name: "a", sha: SHA, "dry-run": "yes" }).pipe(Effect.flip);
			assert.notStrictEqual(error, undefined);
		}),
	);
});
