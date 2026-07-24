import { Schema } from "effect";

/** A single plugin entry; `source` is kept loose so non-git-subdir sources decode too. */
export const MarketplacePlugin = Schema.Struct({
	name: Schema.String,
	source: Schema.Unknown,
});

/**
 * The subset of the marketplace manifest this action reads: the manifest `name`
 * and the ordered `plugins[]`. Extra top-level keys (`owner`, `metadata`) are
 * ignored on decode.
 */
export const Marketplace = Schema.Struct({
	name: Schema.String,
	plugins: Schema.Array(MarketplacePlugin),
});

/** Decoded marketplace shape. */
export type Marketplace = typeof Marketplace.Type;

/** Decode an already-parsed JS value into the {@link Marketplace} read shape. */
export const decodeMarketplace = Schema.decodeUnknownEffect(Marketplace);

/** One applied field change, used by projections and the message/report builders. */
export interface ChangeRecord {
	readonly pluginName: string;
	readonly manifestName: string;
	readonly field: "url" | "path" | "sha";
	readonly value: string;
}
