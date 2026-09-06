import { basename } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { DocumentDiff, SchemaPipeline } from "@effected/schemastore";
import { Effect } from "effect";
import { AppLayer, targets } from "../lib/scripts/generate-schema.js";

describe("generated schema drift", () => {
	for (const target of targets) {
		it.effect(`${basename(target.path)} matches its Effect Schema source`, () =>
			Effect.gen(function* () {
				// The generator's own walk, against the generator's own layer, with no
				// writes. `check` reports rather than enforcing, so every signal has to
				// be asserted separately — and each one has a *different* remedy, which
				// is the whole reason to read them apart rather than collapse them:
				//
				// - `blocked`         — the document could never have been written at
				//                       all. Fix the findings; regenerating won't help.
				// - `contractBlocked` — the contract policy would refuse the write. The
				//                       fix is a version bump, not a regeneration.
				// - `wouldWrite`      — ordinary drift. Run `pnpm generate-schema`.
				//
				// Comparing content rather than text keeps the guard immune to whatever
				// formatted the committed file.
				const result = yield* SchemaPipeline.checkOne(target);

				assert.isFalse(result.blocked, `gate blocked: ${result.findings.map((f) => f.label).join(", ")}`);
				assert.isFalse(
					result.contractBlocked,
					`contract policy would refuse this write (${result.change}) — bump the schema version rather than regenerating`,
				);
				assert.isFalse(result.wouldWrite, `${basename(target.path)} is stale — run \`pnpm generate-schema\``);
				assert.ok(DocumentDiff.isClean(result.change), `expected no drift, got "${result.change}"`);
			}).pipe(Effect.provide(AppLayer)),
		);
	}
});
