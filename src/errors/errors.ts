import { Schema } from "effect";

/** A malformed or contradictory action input, surfaced before any work. */
export class InvalidInputError extends Schema.TaggedErrorClass<InvalidInputError>()("InvalidInputError", {
	field: Schema.String,
	reason: Schema.String,
}) {
	get message(): string {
		return `Invalid input (${this.field}): ${this.reason}`;
	}
}

/** A patch named a plugin that does not exist in `plugins[]`. */
export class PluginNotFoundError extends Schema.TaggedErrorClass<PluginNotFoundError>()("PluginNotFoundError", {
	name: Schema.String,
}) {
	get message(): string {
		return `Plugin not found in marketplace.json: ${this.name}`;
	}
}

/** The resulting manifest failed structural or semantic validation. */
export class ManifestValidationError extends Schema.TaggedErrorClass<ManifestValidationError>()(
	"ManifestValidationError",
	{ errors: Schema.Array(Schema.String) },
) {
	get message(): string {
		return `Manifest validation failed:\n${this.errors.join("\n")}`;
	}
}
