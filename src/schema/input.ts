import { Schema } from "effect";

/** Hosted JSON Schema URL for the `json` input contract. */
export const INPUT_SCHEMA_URL =
	"https://raw.githubusercontent.com/spencerbeggs/claude-code-marketplace-manager/main/claude-code-marketplace-manager.input.json";

/**
 * A single per-plugin partial-merge patch: names an existing plugin and changes
 * only the fields present.
 */
export const PluginPatch = Schema.Struct({
	name: Schema.String.annotate({ description: "Name of an existing plugin to update." }),
	url: Schema.optionalKey(Schema.String).annotate({ description: "New source.url." }),
	path: Schema.optionalKey(Schema.String).annotate({ description: "New source.path." }),
	sha: Schema.optionalKey(Schema.String).annotate({ description: "New source.sha (40-hex)." }),
}).annotate({ identifier: "PluginPatch" });

/** Decoded patch type. */
export type PluginPatch = typeof PluginPatch.Type;

/**
 * The `json` input: an object envelope carrying the per-plugin patches.
 *
 * @remarks
 * A top-level object (rather than a bare array) so this schema is usable as-is
 * by tool-calling / structured-output validators that require an object root.
 * The `plugins` key mirrors `marketplace.json`'s own top-level `plugins` array,
 * leaving room to add sibling keys later without a shape-breaking change.
 */
export const JsonInput = Schema.Struct({
	plugins: Schema.Array(PluginPatch).annotate({ description: "Per-plugin partial-merge patches." }),
}).annotate({ identifier: "MarketplacePatchInput" });

/** Decoded `json` input type. */
export type JsonInput = typeof JsonInput.Type;

/** Decode an already-parsed JS value into the `json` input envelope. */
export const decodeJsonInput = Schema.decodeUnknownEffect(JsonInput);
