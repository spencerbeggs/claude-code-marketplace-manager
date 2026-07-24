import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { parseInputs } from "../src/inputs.js";

const withInputs = (inputs: Record<string, string>) =>
	parseInputs.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(inputs))));

describe("parseInputs", () => {
	it.effect("parses the manual path into a single patch", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: "s" });
			assert.deepStrictEqual(parsed.patches, [{ name: "vitest-agent", sha: "s" }]);
			assert.strictEqual(parsed.mode, "commit");
		}),
	);

	it.effect("defaults auto-merge to rebase", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: "s" });
			assert.strictEqual(parsed.autoMerge, "rebase");
		}),
	);

	it.effect("accepts an explicit auto-merge method", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ name: "vitest-agent", sha: "s", "auto-merge": "squash" });
			assert.strictEqual(parsed.autoMerge, "squash");
		}),
	);

	it.effect("rejects an invalid auto-merge method", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: "s", "auto-merge": "octopus" }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("parses the json path into multiple patches", () =>
		Effect.gen(function* () {
			const parsed = yield* withInputs({ json: '{"plugins":[{"name":"a","sha":"x"},{"name":"b","path":"p"}]}' });
			assert.lengthOf(parsed.patches, 2);
		}),
	);

	it.effect("rejects a json input that is a bare array instead of a plugins envelope", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ json: '[{"name":"a","sha":"x"}]' }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);

	it.effect("rejects supplying both manual and json (XOR)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(withInputs({ name: "a", sha: "s", json: "[]" }));
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
			const error = yield* Effect.flip(withInputs({ name: "a", sha: "s", mode: "sideways" }));
			assert.strictEqual(error._tag, "InvalidInputError");
		}),
	);
});
