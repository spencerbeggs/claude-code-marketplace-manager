import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { parseInputs } from "../src/inputs.js";

const SHA = "1".repeat(40);

const withInputs = (inputs: Record<string, string>) =>
	parseInputs.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(inputs))));

describe("parseInputs", () => {
	it.effect("parses the manual path into a single patch", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: SHA });
			assert.deepStrictEqual(parsed.patches, [{ name: "vitest-agent", sha: SHA }]);
			assert.strictEqual(parsed.mode, "commit");
		}),
	);

	it.effect("rejects a manual-path sha that is not 40-hex lowercase", () =>
		Effect.gen(function* () {
			// The manual path decodes through the same schema as the json path
			// (src/inputs.ts), so the sha pattern applies to both equally.
			const error = yield* Effect.flip(withInputs({ name: "vitest-agent", sha: "not-a-sha" }));
			assert.strictEqual(error._tag, "InvalidInputError");
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
			const parsed = yield* withInputs({ name: "vitest-agent", sha: SHA, "auto-merge": "squash" });
			assert.strictEqual(parsed.autoMerge, "squash");
		}),
	);

	it.effect("rejects an invalid auto-merge method", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, "auto-merge": "octopus" }));
			assert.strictEqual(error._tag, "InvalidInputError");
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
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("rejects supplying both manual and json (XOR)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, json: "[]" }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("rejects neither manual nor json", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({}));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("rejects name with no field", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a" }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("rejects an invalid mode", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: SHA, mode: "sideways" }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);
});
