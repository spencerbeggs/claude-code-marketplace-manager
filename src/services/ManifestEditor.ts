import type { JsoncModificationError, JsoncParseError } from "@effected/jsonc";
import { Jsonc, JsoncEdit, JsoncModifier } from "@effected/jsonc";
import { Effect, FileSystem } from "effect";
import { ManifestValidationError, PluginNotFoundError } from "../errors/errors.js";
import type { PluginPatch } from "../schema/input.js";
import type { ChangeRecord } from "../schema/marketplace.js";
import { decodeMarketplace } from "../schema/marketplace.js";

/** Path of the manifest within the checkout. */
export const MANIFEST_PATH = ".claude-plugin/marketplace.json";

/** Outcome of applying patches to the manifest text. */
export interface EditResult {
	readonly original: string;
	readonly editedText: string;
	readonly changed: boolean;
	readonly manifestName: string;
	readonly changes: ReadonlyArray<ChangeRecord>;
}

const FIELDS = ["url", "path", "sha"] as const;

/** Read the current `source.<field>` value from the parsed manifest, if present. */
const currentValue = (parsed: unknown, index: number, field: "url" | "path" | "sha"): string | undefined => {
	const plugins = (parsed as { plugins?: Array<{ source?: Record<string, unknown> }> }).plugins;
	const source = plugins?.[index]?.source;
	const value = source?.[field];
	return typeof value === "string" ? value : undefined;
};

/**
 * Apply partial-merge patches to the manifest text, format-preservingly. Only
 * provided fields whose value actually differs are written. Returns the edited
 * text, whether anything changed, the manifest `name`, and the change records.
 */
export const applyPatches = (
	text: string,
	patches: ReadonlyArray<PluginPatch>,
): Effect.Effect<
	EditResult,
	PluginNotFoundError | JsoncParseError | JsoncModificationError | ManifestValidationError
> =>
	Effect.gen(function* () {
		let parsed = yield* Jsonc.parse(text);
		const manifest = yield* decodeMarketplace(parsed).pipe(
			Effect.mapError(
				(e) =>
					new ManifestValidationError({
						errors: [`marketplace.json is not a valid marketplace manifest: ${String(e)}`],
					}),
			),
		);
		const manifestName = manifest.name;
		const names = manifest.plugins.map((p) => p.name);

		let currentText = text;
		const changes: Array<ChangeRecord> = [];

		for (const patch of patches) {
			const index = names.indexOf(patch.name);
			if (index === -1) {
				return yield* Effect.fail(new PluginNotFoundError({ name: patch.name }));
			}
			for (const field of FIELDS) {
				const next = patch[field];
				if (next === undefined) {
					continue;
				}
				if (currentValue(parsed, index, field) === next) {
					continue; // unchanged — skip
				}
				const edits = yield* JsoncModifier.modify(currentText, ["plugins", index, "source", field], next);
				currentText = JsoncEdit.applyAll(currentText, edits);
				parsed = yield* Jsonc.parse(currentText);
				changes.push({ pluginName: patch.name, manifestName, field, value: next });
			}
		}

		return { original: text, editedText: currentText, changed: currentText !== text, manifestName, changes };
	});

/**
 * Read the manifest text from the checkout. The error type is inferred from
 * `fs.readFileString` (a platform error, not one of our tagged errors), so no
 * explicit error annotation is needed.
 */
export const readManifest = (path: string = MANIFEST_PATH) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path));
