import { ActionOutputs, GitHubToken } from "@savvy-web/github-action-effects";
import { Effect, Exit } from "effect";
import type { ParsedInputs } from "./inputs.js";
import { parseInputs } from "./inputs.js";
import { buildSummary, commitSubject, defaultCommitMessage, messageBody } from "./report.js";
import { toReportOutput } from "./schema/projections.js";
import { ReportOutput } from "./schema/report-output.js";
import { land, resolveBaseBranch } from "./services/ManifestCommitter.js";
import { applyPatches, readManifest } from "./services/ManifestEditor.js";
import { validateEdit } from "./services/ManifestValidator.js";

/** Emit the structured result (non-fatal), convenience scalars, and the job summary (non-fatal). */
const emit = (outputs: typeof ActionOutputs.Service, output: ReportOutput) =>
	Effect.gen(function* () {
		yield* outputs
			.setJson("result", output, ReportOutput)
			.pipe(Effect.catch((e) => Effect.logWarning(`Failed to emit result: ${String(e)}`)));
		yield* outputs.set("status", output.status);
		yield* outputs.set("changed", output.succeeded && !output.noop ? "true" : "false");
		yield* outputs.set("mode", output.mode);
		yield* outputs.set("commit-sha", output.commit?.sha ?? "");
		yield* outputs.set("commit-url", output.commit?.url ?? "");
		yield* outputs.set("pr-number", output.pr === null ? "" : String(output.pr.number));
		yield* outputs.set("pr-url", output.pr?.url ?? "");
		yield* outputs.set("plugins-updated", String(output.pluginsUpdated));
		yield* outputs
			.summary(buildSummary(output))
			.pipe(Effect.catch((e) => Effect.logWarning(`Failed to write summary: ${String(e)}`)));
	});

/** Emit a structured failed `result` (best-effort) for the given mode/dry-run. */
const emitFailure = (outputs: typeof ActionOutputs.Service, mode: "commit" | "pr", dryRun: boolean) =>
	emit(
		outputs,
		toReportOutput({
			mode,
			dryRun,
			changes: [],
			commitSha: null,
			commitUrl: null,
			prNumber: null,
			prUrl: null,
			succeeded: false,
			hasFailures: true,
		}),
	);

/** Read, edit, validate, and land the manifest change once inputs are parsed. */
const runOrchestration = (outputs: typeof ActionOutputs.Service, inputs: ParsedInputs) =>
	Effect.gen(function* () {
		// 1–4: read, edit, no-op guard.
		const text = yield* readManifest();
		const edit = yield* applyPatches(text, inputs.patches);

		if (!edit.changed) {
			yield* Effect.logInfo("Step: edit — SKIPPED: no changes; nothing to commit");
			const output = toReportOutput({
				mode: inputs.mode,
				dryRun: inputs.dryRun,
				changes: [],
				commitSha: null,
				commitUrl: null,
				prNumber: null,
				prUrl: null,
				succeeded: true,
				hasFailures: false,
			});
			yield* emit(outputs, output);
			return;
		}

		// 5: validate the result before any commit. `edit` has narrowed to
		// ChangedEdit at the guard above, and `validateEdit` mints the branded
		// change that `land` requires — the two halves of the commit-time
		// invariant, both enforced by the type checker rather than by this
		// function's ordering.
		const change = yield* validateEdit(
			edit,
			inputs.patches.map((p) => p.name),
		);

		if (inputs.dryRun) {
			yield* Effect.logInfo("Step: land — SKIPPED: dry run");
			const output = toReportOutput({
				mode: inputs.mode,
				dryRun: true,
				changes: edit.changes,
				commitSha: null,
				commitUrl: null,
				prNumber: null,
				prUrl: null,
				succeeded: true,
				hasFailures: false,
			});
			yield* emit(outputs, output);
			return;
		}

		// Messages (defaults from the change set; DCO trailer from the bot identity).
		// Computed only on the land path — dry-run never reads the token identity, so
		// the dry-run test needs no provisioned token.
		const bot = yield* GitHubToken.botIdentity();
		const commitMessage = inputs.commitMessage ?? defaultCommitMessage(edit.changes, bot);
		const prTitle = inputs.prTitle ?? commitSubject(edit.changes);
		const prBody = inputs.prBody ?? messageBody(edit.changes);

		// 6: land.
		const base = yield* resolveBaseBranch(inputs.baseBranch);
		const result = yield* land({
			mode: inputs.mode,
			base,
			branch: inputs.branch,
			change,
			commitMessage,
			prTitle,
			prBody,
			autoMerge: inputs.autoMerge,
		});

		const output = toReportOutput({
			mode: inputs.mode,
			dryRun: false,
			changes: edit.changes,
			commitSha: result.commitSha,
			commitUrl: result.commitUrl,
			prNumber: result.prNumber,
			prUrl: result.prUrl,
			succeeded: true,
			hasFailures: false,
		});
		yield* emit(outputs, output);
	});

/**
 * The main orchestration program. A typed failure (input parsing, validation,
 * or landing) still emits a structured failed `result` before re-raising, so
 * downstream consumers see the modeled `status: "failed"` / `hasFailures: true`
 * state — and the action still exits non-zero via `Action.run`.
 */
export const program = Effect.gen(function* () {
	const outputs = yield* ActionOutputs;

	const inputsExit = yield* Effect.exit(parseInputs);
	if (Exit.isFailure(inputsExit)) {
		// Inputs never parsed; fall back to the commit-mode, non-dry-run defaults.
		yield* emitFailure(outputs, "commit", false);
		return yield* Effect.failCause(inputsExit.cause);
	}
	const inputs = inputsExit.value;

	const bodyExit = yield* Effect.exit(runOrchestration(outputs, inputs));
	if (Exit.isFailure(bodyExit)) {
		yield* emitFailure(outputs, inputs.mode, inputs.dryRun);
		return yield* Effect.failCause(bodyExit.cause);
	}
});
