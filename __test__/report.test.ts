import { describe, expect, it } from "vitest";
import { commitSubject, defaultCommitMessage, messageBody } from "../src/report.js";

const c = (pluginName: string, field: "url" | "path" | "sha", value: string) => ({
	pluginName,
	manifestName: "savvy-web-systems",
	field,
	value,
});

describe("message generation", () => {
	it("single-plugin subject", () => {
		expect(commitSubject([c("plugin-bot", "sha", "19619a3")])).toBe(
			"ai(marketplace): repinned plugin-bot@savvy-web-systems",
		);
	});

	it("multi-plugin subject counts distinct plugins", () => {
		expect(commitSubject([c("a", "sha", "1"), c("a", "path", "p"), c("b", "sha", "2")])).toBe(
			"ai(marketplace): repinned 2 plugins",
		);
	});

	it("body has one bullet per field with the right verb", () => {
		expect(messageBody([c("silk", "sha", "19619a3"), c("plugin-bot", "path", "plugins/foobar")])).toBe(
			"- pinned silk@savvy-web-systems to 19619a3\n- changed path of plugin-bot@savvy-web-systems to plugins/foobar",
		);
	});

	it("commit message appends a DCO trailer after a blank line", () => {
		const msg = defaultCommitMessage([c("silk", "sha", "abc")], {
			name: "plugin-bot[bot]",
			email: "209691739+plugin-bot[bot]@users.noreply.github.com",
		});
		expect(msg).toBe(
			"ai(marketplace): repinned silk@savvy-web-systems\n\n" +
				"- pinned silk@savvy-web-systems to abc\n\n" +
				"Signed-off-by: plugin-bot[bot] <209691739+plugin-bot[bot]@users.noreply.github.com>",
		);
	});
});
