import { GithubMarkdown } from "@savvy-web/github-action-effects";
import type { ChangeRecord } from "./schema/marketplace.js";
import type { ReportOutput } from "./schema/report-output.js";

const distinctPlugins = (changes: ReadonlyArray<ChangeRecord>): ReadonlyArray<string> => {
	const seen: Array<string> = [];
	for (const c of changes) {
		if (!seen.includes(c.pluginName)) {
			seen.push(c.pluginName);
		}
	}
	return seen;
};

const bullet = (c: ChangeRecord): string => {
	const ref = `${c.pluginName}@${c.manifestName}`;
	switch (c.field) {
		case "sha":
			return `- pinned ${ref} to ${c.value}`;
		case "path":
			return `- changed path of ${ref} to ${c.value}`;
		case "url":
			return `- changed url of ${ref} to ${c.value}`;
	}
};

/** The `ai(marketplace): …` subject / PR title. */
export const commitSubject = (changes: ReadonlyArray<ChangeRecord>): string => {
	const plugins = distinctPlugins(changes);
	if (plugins.length === 1) {
		const [first] = changes;
		return `ai(marketplace): repinned ${first.pluginName}@${first.manifestName}`;
	}
	return `ai(marketplace): repinned ${plugins.length} plugins`;
};

/** One bullet per changed field, per plugin. */
export const messageBody = (changes: ReadonlyArray<ChangeRecord>): string => changes.map(bullet).join("\n");

/** Full default commit message: subject, body, and a DCO trailer from the App bot identity. */
export const defaultCommitMessage = (
	changes: ReadonlyArray<ChangeRecord>,
	bot: { readonly name: string; readonly email: string },
): string => `${commitSubject(changes)}\n\n${messageBody(changes)}\n\nSigned-off-by: ${bot.name} <${bot.email}>`;

/** Non-fatal markdown job summary. */
export const buildSummary = (output: ReportOutput): string => {
	const rows: Array<[string, string]> = [
		["Status", output.status],
		["Mode", output.mode],
		["Plugins updated", String(output.pluginsUpdated)],
		["Dry run", output.dryRun ? "yes" : "no"],
	];
	if (output.commit) {
		rows.push(["Commit", output.commit.url ?? output.commit.sha]);
	}
	if (output.pr) {
		rows.push(["PR", output.pr.url ?? `#${output.pr.number}`]);
	}
	const blocks = [
		GithubMarkdown.heading("📦 Marketplace Manager", 2),
		GithubMarkdown.table(["Property", "Value"], rows),
	];
	if (output.plugins.length > 0) {
		blocks.push(GithubMarkdown.list(output.plugins.map((p) => `\`${p.name}\` — ${p.fields.join(", ")}`)));
	}
	return blocks.join("\n\n");
};
