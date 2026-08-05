import { basename } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { DocumentDiff, SchemaFile, SchemaPipeline, SchemaValidator } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { targets } from "../lib/scripts/generate-schema.js";

const TestLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provide(NodeServices.layer));

describe("generated schema drift", () => {
	for (const target of targets) {
		it.effect(`${basename(target.path)} matches its Effect Schema source`, () =>
			Effect.gen(function* () {
				// The generator's own walk with no writes. `check` reports rather than
				// enforcing, so both halves have to be asserted: `blocked` catches a
				// document that could never have been written, and `change` catches
				// drift. Comparing content rather than text keeps the guard immune to
				// whatever formatted the committed file.
				const result = yield* SchemaPipeline.checkOne(target);
				assert.isFalse(result.blocked, `gate blocked: ${result.findings.map((f) => f.label).join(", ")}`);
				assert.ok(DocumentDiff.isClean(result.change), `expected no drift, got "${result.change}"`);
			}).pipe(Effect.provide(TestLayer)),
		);
	}
});
