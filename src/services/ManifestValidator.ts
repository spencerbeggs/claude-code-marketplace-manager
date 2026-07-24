import { Jsonc } from "@effected/jsonc";
import Ajv from "ajv";
import { Effect } from "effect";
import { ManifestValidationError } from "../errors/errors.js";
// biome-ignore lint/correctness/useImportExtensions: forceJsExtensions rewrites this already-correct `.json` extension to `.js`, which breaks resolution; this is a JSON asset import, not a relative TS/JS module import.
import marketplaceSchema from "../schema/claude-code-marketplace.json" with { type: "json" };

const SHA_RE = /^[0-9a-f]{40}$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;

// The bundled schema's `$schema` is draft-07 (verified in Task 1), so the default
// `Ajv` export handles it. `strict: false` is deliberate: we're validating the
// DATA against a third-party SchemaStore schema, not strict-linting the schema
// itself — strict mode can throw on its keywords/formats. `logger: false`
// silences ajv's "unknown format" warnings (we don't ship `ajv-formats`; the
// `uri`/`uri-reference` formats in the SchemaStore schema go unvalidated,
// which is fine — semantic checks re-validate `url` for touched plugins).
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
const validateStructural = ajv.compile(marketplaceSchema as object);

interface RawPlugin {
	readonly name?: unknown;
	readonly source?: {
		readonly source?: unknown;
		readonly url?: unknown;
		readonly path?: unknown;
		readonly sha?: unknown;
	};
}

const semanticErrors = (parsed: unknown, patchedNames: ReadonlyArray<string>): Array<string> => {
	const errors: Array<string> = [];
	const plugins = (parsed as { plugins?: Array<RawPlugin> }).plugins ?? [];
	const names = plugins.map((p) => (typeof p.name === "string" ? p.name : ""));

	const seen = new Set<string>();
	for (const n of names) {
		if (n === "") {
			continue; // nameless plugins are a structural error, not a duplicate
		}
		if (seen.has(n)) {
			errors.push(`duplicate plugin name: ${n}`);
		}
		seen.add(n);
	}
	for (const n of patchedNames) {
		if (!names.includes(n)) {
			errors.push(`patched plugin not present after edit: ${n}`);
		}
	}
	for (const p of plugins) {
		if (!patchedNames.includes(typeof p.name === "string" ? p.name : "")) {
			continue; // only re-check plugins we touched
		}
		const s = p.source ?? {};
		if (s.source !== "git-subdir") {
			errors.push(`${String(p.name)}: source.source must be "git-subdir"`);
		}
		if (typeof s.url !== "string" || !GITHUB_URL_RE.test(s.url)) {
			errors.push(`${String(p.name)}: source.url must be a GitHub URL`);
		}
		if (typeof s.path !== "string" || s.path.length === 0) {
			errors.push(`${String(p.name)}: source.path must be non-empty`);
		}
		if (typeof s.sha !== "string" || !SHA_RE.test(s.sha)) {
			errors.push(`${String(p.name)}: source.sha must be 40-hex lowercase`);
		}
	}
	return errors;
};

/** Validate the edited manifest structurally (ajv) and semantically. Fails with all reasons. */
export const validateManifest = (
	editedText: string,
	patchedNames: ReadonlyArray<string>,
): Effect.Effect<void, ManifestValidationError> =>
	Effect.gen(function* () {
		const parsed = yield* Jsonc.parse(editedText).pipe(
			Effect.mapError(() => new ManifestValidationError({ errors: ["resulting manifest is not valid JSON/JSONC"] })),
		);
		const errors: Array<string> = [];
		if (!validateStructural(parsed)) {
			for (const e of validateStructural.errors ?? []) {
				errors.push(`${e.instancePath || "/"} ${e.message ?? "invalid"}`);
			}
		}
		errors.push(...semanticErrors(parsed, patchedNames));
		if (errors.length > 0) {
			return yield* Effect.fail(new ManifestValidationError({ errors }));
		}
	});
