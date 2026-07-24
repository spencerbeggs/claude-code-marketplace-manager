import { describe, expect, it } from "vitest";
import { toReportOutput } from "../../src/schema/projections.js";
import { SCHEMA_URL, SCHEMA_VERSION } from "../../src/schema/report-output.js";

const change = { pluginName: "p1", manifestName: "acme", field: "sha" as const, value: "s" };

describe("toReportOutput", () => {
	it("marks a no-op when nothing changed", () => {
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [],
			commitSha: null,
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: true,
			hasFailures: false,
		});
		expect(out.$schema).toBe(SCHEMA_URL);
		expect(out.schemaVersion).toBe(SCHEMA_VERSION);
		expect(out.noop).toBe(true);
		expect(out.status).toBe("no-op");
		expect(out.pluginsUpdated).toBe(0);
	});

	it("reports success with a commit sha", () => {
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [change],
			commitSha: "abc",
			commitUrl: "http://c",
			prNumber: null,
			prUrl: null,
			succeeded: true,
			hasFailures: false,
		});
		expect(out.noop).toBe(false);
		expect(out.succeeded).toBe(true);
		expect(out.status).toBe("success");
		expect(out.pluginsUpdated).toBe(1);
		expect(out.commit?.sha).toBe("abc");
	});

	it("groups multiple distinct plugins, preserving first-seen order and count", () => {
		const changeB = { pluginName: "b", manifestName: "acme", field: "url" as const, value: "http://b" };
		const changeA = { pluginName: "a", manifestName: "acme", field: "path" as const, value: "./a" };
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [changeB, changeA],
			commitSha: "abc",
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: true,
			hasFailures: false,
		});
		expect(out.pluginsUpdated).toBe(2);
		expect(out.plugins.map((p) => p.name)).toEqual(["b", "a"]);
		expect(out.plugins[0]?.fields).toEqual(["url"]);
		expect(out.plugins[1]?.fields).toEqual(["path"]);
	});

	it("accumulates multiple fields for the same plugin into one entry", () => {
		const shaChange = { pluginName: "p1", manifestName: "acme", field: "sha" as const, value: "s" };
		const pathChange = { pluginName: "p1", manifestName: "acme", field: "path" as const, value: "./p" };
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [shaChange, pathChange],
			commitSha: "abc",
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: true,
			hasFailures: false,
		});
		expect(out.pluginsUpdated).toBe(1);
		expect(out.plugins).toHaveLength(1);
		expect(out.plugins[0]?.name).toBe("p1");
		expect(out.plugins[0]?.fields).toEqual(["sha", "path"]);
	});

	it("reports the pr branch with pr populated and commit null", () => {
		const out = toReportOutput({
			mode: "pr",
			dryRun: false,
			changes: [change],
			commitSha: null,
			commitUrl: null,
			prNumber: 42,
			prUrl: "http://pr",
			succeeded: true,
			hasFailures: false,
		});
		expect(out.mode).toBe("pr");
		expect(out.status).toBe("success");
		expect(out.commit).toBeNull();
		expect(out.pr).toEqual({ number: 42, url: "http://pr" });
	});

	it("reports status failed when succeeded is false and hasFailures is true", () => {
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [change],
			commitSha: null,
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: false,
			hasFailures: true,
		});
		expect(out.status).toBe("failed");
		expect(out.succeeded).toBe(false);
		expect(out.hasFailures).toBe(true);
		expect(out.noop).toBe(false);
	});

	it("reports status failed with no changes when succeeded is false and hasFailures is true", () => {
		const out = toReportOutput({
			mode: "commit",
			dryRun: false,
			changes: [],
			commitSha: null,
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: false,
			hasFailures: true,
		});
		expect(out.status).toBe("failed");
		expect(out.succeeded).toBe(false);
		expect(out.hasFailures).toBe(true);
		expect(out.pluginsUpdated).toBe(0);
	});
});
