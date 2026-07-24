import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeJsonInput } from "../../src/schema/input.js";

describe("json input schema", () => {
	it.effect("decodes a plugins envelope of partial patches", () =>
		Effect.gen(function* () {
			const parsed = yield* decodeJsonInput({
				plugins: [
					{ name: "a", sha: "s" },
					{ name: "b", path: "p", url: "u" },
				],
			});
			assert.deepStrictEqual(parsed.plugins, [
				{ name: "a", sha: "s" },
				{ name: "b", path: "p", url: "u" },
			]);
			const [first] = parsed.plugins;
			assert.isFalse(Object.hasOwn(first ?? {}, "url"));
			assert.isFalse(Object.hasOwn(first ?? {}, "path"));
		}),
	);

	it.effect("rejects a bare array (no plugins envelope)", () =>
		Effect.gen(function* () {
			yield* Effect.flip(decodeJsonInput([{ name: "a", sha: "s" }]));
		}),
	);

	it.effect("rejects an object missing plugins", () =>
		Effect.gen(function* () {
			yield* Effect.flip(decodeJsonInput({ name: "a" }));
		}),
	);
});
