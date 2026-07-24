import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildActionJsonSchema } from "../lib/scripts/generate-schema.js";
import { INPUT_SCHEMA_URL, JsonInput } from "../src/schema/input.js";
import { ReportOutput, SCHEMA_URL } from "../src/schema/report-output.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("generated schema drift", () => {
	for (const [schema, $id, file] of [
		[ReportOutput, SCHEMA_URL, "claude-code-marketplace-manager.output.json"],
		[JsonInput, INPUT_SCHEMA_URL, "claude-code-marketplace-manager.input.json"],
	] as const) {
		it(`${file} matches its Effect Schema source`, () => {
			const generated = buildActionJsonSchema(schema, $id);
			const committed = JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
			expect(committed).toEqual(generated);
		});
	}
});
