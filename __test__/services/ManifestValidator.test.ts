import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { validateManifest } from "../../src/services/ManifestValidator.js";

const good = JSON.stringify({
	name: "acme",
	owner: { name: "Acme" },
	plugins: [
		{
			name: "p1",
			source: { source: "git-subdir", url: "https://github.com/acme/p1", path: "plugin", sha: "a".repeat(40) },
		},
	],
});

describe("validateManifest", () => {
	it.effect("accepts a well-formed manifest", () => validateManifest(good, ["p1"]));

	it.effect("rejects a non-40-hex sha", () =>
		Effect.gen(function* () {
			const bad = JSON.stringify({
				name: "acme",
				plugins: [
					{
						name: "p1",
						source: { source: "git-subdir", url: "https://github.com/acme/p1", path: "plugin", sha: "zzz" },
					},
				],
			});
			yield* Effect.flip(validateManifest(bad, ["p1"]));
		}),
	);

	it.effect("rejects a patched name that is absent", () =>
		Effect.gen(function* () {
			yield* Effect.flip(validateManifest(good, ["ghost"]));
		}),
	);

	it.effect("aggregates multiple semantic errors on a structurally-valid manifest", () =>
		Effect.gen(function* () {
			const validSource = {
				source: "git-subdir",
				url: "https://github.com/acme/p1",
				path: "plugin",
				sha: "a".repeat(40),
			};
			const dup = JSON.stringify({
				name: "acme",
				owner: { name: "Acme" },
				plugins: [
					{ name: "dup", source: validSource },
					{ name: "dup", source: validSource },
				],
			});
			const error = yield* Effect.flip(validateManifest(dup, ["ghost"]));
			assert.strictEqual(error._tag, "ManifestValidationError");
			assert.isAtLeast(error.errors.length, 2);
			assert.isTrue(error.errors.some((e) => e.includes("duplicate")));
			assert.isTrue(error.errors.some((e) => e.includes("ghost")));
		}),
	);
});
