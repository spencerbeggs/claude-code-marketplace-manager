import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { applyPatches } from "../../src/services/ManifestEditor.js";

const MANIFEST = `{
	// marketplace
	"name": "acme",
	"plugins": [
		{ "name": "p1", "source": { "source": "git-subdir", "url": "https://github.com/acme/p1", "path": "plugin", "sha": "0000000000000000000000000000000000000000" } }
	]
}
`;

describe("applyPatches", () => {
	it.effect("updates only the provided field and preserves the comment", () =>
		Effect.gen(function* () {
			const result = yield* applyPatches(MANIFEST, [{ name: "p1", sha: "1111111111111111111111111111111111111111" }]);
			assert.isTrue(result.changed);
			assert.strictEqual(result.manifestName, "acme");
			assert.include(result.editedText, "1111111111111111111111111111111111111111");
			assert.include(result.editedText, "// marketplace");
			assert.include(result.editedText, '"path": "plugin"');
			assert.deepStrictEqual(result.changes, [
				{ pluginName: "p1", manifestName: "acme", field: "sha", value: "1111111111111111111111111111111111111111" },
			]);
		}),
	);

	it.effect("is a no-op when the value is unchanged", () =>
		Effect.gen(function* () {
			const result = yield* applyPatches(MANIFEST, [{ name: "p1", sha: "0000000000000000000000000000000000000000" }]);
			assert.isFalse(result.changed);
			assert.strictEqual(result.editedText, MANIFEST);
			assert.deepStrictEqual(result.changes, []);
		}),
	);

	it.effect("last-write-wins when two patches target the same plugin+field", () =>
		Effect.gen(function* () {
			// Original sha is 40×"0". Patch 1 sets it to 40×"1" (applied), patch 2 sets
			// it back to 40×"0" (the original value). With the bug, patch 2's
			// "unchanged?" check reads the never-updated original parse, sees
			// "0" === "0", and incorrectly skips — leaving the wrong 40×"1" in the
			// text. Fixed, patch 2 sees the RUNNING state (40×"1") and correctly
			// applies, restoring 40×"0" — which round-trips back to the exact
			// original bytes.
			const result = yield* applyPatches(MANIFEST, [
				{ name: "p1", sha: "1".repeat(40) },
				{ name: "p1", sha: "0".repeat(40) },
			]);
			assert.include(result.editedText, `"sha": "${"0".repeat(40)}"`);
			assert.notInclude(result.editedText, "1".repeat(40));
			assert.strictEqual(result.editedText, MANIFEST);
			assert.isFalse(result.changed);
			assert.deepStrictEqual(result.changes, [
				{ pluginName: "p1", manifestName: "acme", field: "sha", value: "1".repeat(40) },
				{ pluginName: "p1", manifestName: "acme", field: "sha", value: "0".repeat(40) },
			]);
		}),
	);

	it.effect("does not record a duplicate edit for two identical-value patches", () =>
		Effect.gen(function* () {
			const result = yield* applyPatches(MANIFEST, [
				{ name: "p1", sha: "1".repeat(40) },
				{ name: "p1", sha: "1".repeat(40) },
			]);
			assert.isTrue(result.changed);
			assert.include(result.editedText, `"sha": "${"1".repeat(40)}"`);
			assert.deepStrictEqual(result.changes, [
				{ pluginName: "p1", manifestName: "acme", field: "sha", value: "1".repeat(40) },
			]);
		}),
	);

	it.effect("fails with PluginNotFoundError for an unknown plugin", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(applyPatches(MANIFEST, [{ name: "ghost", sha: "1".repeat(40) }]));
			assert.strictEqual(error._tag, "PluginNotFoundError");
		}),
	);

	it.effect("fails with ManifestValidationError for a JSONC-valid but structurally-invalid manifest", () =>
		Effect.gen(function* () {
			const INVALID_MANIFEST = `{
	"name": "acme",
	"plugins": [
		{ "source": { "source": "git-subdir", "url": "https://github.com/acme/p1", "path": "plugin", "sha": "0000000000000000000000000000000000000000" } }
	]
}
`;
			const error = yield* Effect.flip(
				applyPatches(INVALID_MANIFEST, [{ name: "p1", sha: "1111111111111111111111111111111111111111" }]),
			);
			assert.strictEqual(error._tag, "ManifestValidationError");
		}),
	);
});
