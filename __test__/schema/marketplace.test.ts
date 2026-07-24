import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeMarketplace } from "../../src/schema/marketplace.js";

describe("marketplace schema", () => {
	it.effect("decodes name + plugins, ignoring extra top-level keys", () =>
		Effect.gen(function* () {
			const value = {
				name: "acme",
				owner: { name: "Acme" },
				metadata: { version: "1" },
				plugins: [
					{ name: "p2", source: { source: "git-subdir", url: "u2", path: "x2", sha: "s2" } },
					{ name: "p1", source: { source: "git-subdir", url: "u1", path: "x1", sha: "s1" } },
				],
			};
			const result = yield* decodeMarketplace(value);
			assert.strictEqual(result.name, "acme");
			assert.deepStrictEqual(
				result.plugins.map((p) => p.name),
				["p2", "p1"],
			);
			assert.isUndefined((result as { owner?: unknown }).owner);
			assert.isUndefined((result as { metadata?: unknown }).metadata);
		}),
	);
});
