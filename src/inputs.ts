import { ActionInput } from "@effected/github-actions";
import type { Config } from "effect";
import { Config as Cfg, Effect } from "effect";
import { InvalidInputError } from "./errors/errors.js";
import type { PluginPatch } from "./schema/input.js";
import { decodeJsonInput } from "./schema/input.js";

/** Merge method for PR auto-merge. Meaningful only in `pr` mode. */
export type AutoMergeMethod = "merge" | "squash" | "rebase";

/** Fully parsed, validated action inputs. */
export interface ParsedInputs {
	readonly patches: ReadonlyArray<PluginPatch>;
	readonly mode: "commit" | "pr";
	/** `null` ⇒ resolve the repo default branch at runtime. */
	readonly baseBranch: string | null;
	readonly branch: string;
	readonly commitMessage: string | null;
	readonly prTitle: string | null;
	readonly prBody: string | null;
	/** Auto-merge method to enable on the PR. Ignored in `commit` mode. */
	readonly autoMerge: AutoMergeMethod;
	readonly dryRun: boolean;
}

const emptyToNull = (s: string): string | null => (s.length === 0 ? null : s);

/**
 * Read and validate all inputs, enforcing the manual/json XOR.
 *
 * @remarks
 * Every read goes through an `ActionInput` accessor, which owns the `INPUT_`
 * derivation — no caller spells a runner variable. A bare `Config.string` would
 * also resolve here, because `Action.run` installs `ActionInput.providerOver`
 * as the default provider, which is exactly why the substitution is easy to
 * miss in review.
 *
 * Optional inputs take `Config.withDefault` because the runner writes `""` for
 * an omitted input and the kit treats missing and empty as the same *missing
 * data*. None of this action's inputs use empty as a meaningful value, so
 * `Config.option` is not needed anywhere — if one ever does, `withDefault`
 * would silently swallow it and `Config.option` is the fix.
 */
export const parseInputs: Effect.Effect<ParsedInputs, InvalidInputError | Config.ConfigError> = Effect.gen(
	function* () {
		const name = yield* ActionInput.string("name").pipe(Cfg.withDefault(""));
		const url = yield* ActionInput.string("url").pipe(Cfg.withDefault(""));
		const path = yield* ActionInput.string("path").pipe(Cfg.withDefault(""));
		const sha = yield* ActionInput.string("sha").pipe(Cfg.withDefault(""));
		const json = yield* ActionInput.string("json").pipe(Cfg.withDefault(""));

		const hasManual = name.length > 0 || url.length > 0 || path.length > 0 || sha.length > 0;
		const hasJson = json.length > 0;

		if (hasManual && hasJson) {
			return yield* Effect.fail(
				new InvalidInputError({ field: "json", reason: "provide either the manual fields or json, not both" }),
			);
		}
		if (!hasManual && !hasJson) {
			return yield* Effect.fail(
				new InvalidInputError({ field: "name/json", reason: "provide the manual fields (name + a field) or json" }),
			);
		}

		let patches: ReadonlyArray<PluginPatch>;
		if (hasJson) {
			const parsed = yield* Effect.try({
				try: () => JSON.parse(json) as unknown,
				catch: () => new InvalidInputError({ field: "json", reason: "not valid JSON" }),
			});
			const decoded = yield* decodeJsonInput(parsed).pipe(
				Effect.mapError(
					() =>
						new InvalidInputError({
							field: "json",
							reason: 'not an object of shape {"plugins":[{name,url?,path?,sha?}]}',
						}),
				),
			);
			patches = decoded.plugins;
		} else {
			if (name.length === 0) {
				return yield* Effect.fail(new InvalidInputError({ field: "name", reason: "required for the manual path" }));
			}
			if (url.length === 0 && path.length === 0 && sha.length === 0) {
				return yield* Effect.fail(
					new InvalidInputError({ field: "url/path/sha", reason: "provide at least one field to change" }),
				);
			}
			// Decode through the same schema as the json path so both forms get
			// identical validation (e.g. the sha 40-hex pattern) and error shape.
			const decoded = yield* decodeJsonInput({
				plugins: [
					{
						name,
						...(url.length > 0 ? { url } : {}),
						...(path.length > 0 ? { path } : {}),
						...(sha.length > 0 ? { sha } : {}),
					},
				],
			}).pipe(
				Effect.mapError(
					() => new InvalidInputError({ field: "name/url/path/sha", reason: "invalid manual plugin patch" }),
				),
			);
			patches = decoded.plugins;
		}

		const modeRaw = yield* ActionInput.string("mode").pipe(Cfg.withDefault("commit"));
		if (modeRaw !== "commit" && modeRaw !== "pr") {
			return yield* Effect.fail(new InvalidInputError({ field: "mode", reason: `expected commit|pr, got ${modeRaw}` }));
		}

		const baseBranch = emptyToNull(yield* ActionInput.string("base-branch").pipe(Cfg.withDefault("")));
		const branch = yield* ActionInput.string("branch").pipe(Cfg.withDefault("chore/repin-plugins"));
		const commitMessage = emptyToNull(yield* ActionInput.string("commit-message").pipe(Cfg.withDefault("")));
		const prTitle = emptyToNull(yield* ActionInput.string("pr-title").pipe(Cfg.withDefault("")));
		const prBody = emptyToNull(yield* ActionInput.string("pr-body").pipe(Cfg.withDefault("")));

		const autoMergeRaw = yield* ActionInput.string("auto-merge").pipe(Cfg.withDefault("rebase"));
		if (autoMergeRaw !== "merge" && autoMergeRaw !== "squash" && autoMergeRaw !== "rebase") {
			return yield* Effect.fail(
				new InvalidInputError({ field: "auto-merge", reason: `expected merge|squash|rebase, got ${autoMergeRaw}` }),
			);
		}

		// `ActionInput.boolean` fails a MALFORMED value rather than defaulting it:
		// it builds its ConfigError carrying `actual`, which is what stops
		// `withDefault` from classifying it as missing data. The pre-port library
		// shipped the opposite behavior, where `dry-run: yes` silently read false.
		const dryRun = yield* ActionInput.boolean("dry-run").pipe(Cfg.withDefault(false));

		return {
			patches,
			mode: modeRaw,
			baseBranch,
			branch,
			commitMessage,
			prTitle,
			prBody,
			autoMerge: autoMergeRaw,
			dryRun,
		};
	},
);
