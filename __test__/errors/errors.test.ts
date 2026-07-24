import { describe, expect, it } from "vitest";
import { InvalidInputError, ManifestValidationError, PluginNotFoundError } from "../../src/errors/errors.js";

describe("errors", () => {
	it("InvalidInputError renders field + reason", () => {
		const e = new InvalidInputError({ field: "json", reason: "not an array" });
		expect(e._tag).toBe("InvalidInputError");
		expect(e.message).toBe("Invalid input (json): not an array");
	});

	it("PluginNotFoundError names the plugin", () => {
		expect(new PluginNotFoundError({ name: "ghost" }).message).toBe("Plugin not found in marketplace.json: ghost");
	});

	it("ManifestValidationError joins the reasons", () => {
		const e = new ManifestValidationError({ errors: ["a", "b"] });
		expect(e.message).toBe("Manifest validation failed:\na\nb");
	});
});
