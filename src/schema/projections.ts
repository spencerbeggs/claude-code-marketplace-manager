import type { ChangeRecord } from "./marketplace.js";
import type { ReportOutput, ResultStatus } from "./report-output.js";
import { SCHEMA_URL, SCHEMA_VERSION } from "./report-output.js";

/** Inputs to the pure output projection. */
export interface ProjectionInput {
	readonly mode: "commit" | "pr";
	readonly dryRun: boolean;
	readonly changes: ReadonlyArray<ChangeRecord>;
	readonly commitSha: string | null;
	readonly commitUrl: string | null;
	readonly prNumber: number | null;
	readonly prUrl: string | null;
	readonly succeeded: boolean;
	readonly hasFailures: boolean;
}

const deriveStatus = (noop: boolean, succeeded: boolean): ResultStatus =>
	!succeeded ? "failed" : noop ? "no-op" : "success";

/** Group flat change records into `{ name, fields[] }` per plugin, preserving order. */
const groupPlugins = (
	changes: ReadonlyArray<ChangeRecord>,
): ReadonlyArray<{ name: string; fields: Array<"url" | "path" | "sha"> }> => {
	const order: Array<string> = [];
	const byName = new Map<string, Array<"url" | "path" | "sha">>();
	for (const c of changes) {
		if (!byName.has(c.pluginName)) {
			byName.set(c.pluginName, []);
			order.push(c.pluginName);
		}
		byName.get(c.pluginName)?.push(c.field);
	}
	return order.map((name) => ({ name, fields: byName.get(name) ?? [] }));
};

/** Project the applied-change set and land outcome into the `result` struct. Pure. */
export const toReportOutput = (input: ProjectionInput): ReportOutput => {
	const plugins = groupPlugins(input.changes);
	const noop = input.changes.length === 0;
	return {
		$schema: SCHEMA_URL,
		schemaVersion: SCHEMA_VERSION,
		mode: input.mode,
		status: deriveStatus(noop, input.succeeded),
		noop,
		succeeded: input.succeeded,
		hasFailures: input.hasFailures,
		dryRun: input.dryRun,
		pluginsUpdated: plugins.length,
		plugins,
		commit: input.commitSha === null ? null : { sha: input.commitSha, url: input.commitUrl },
		pr: input.prNumber === null ? null : { number: input.prNumber, url: input.prUrl },
	};
};
