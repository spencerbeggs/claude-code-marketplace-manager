/**
 * The action's declared interface: every input and output name, and the
 * defaults that are not simply `""`.
 *
 * @remarks
 * `action.yml` is the manifest GitHub reads, but nothing in the type system
 * connects it to the code that reads those inputs and writes those outputs.
 * The two drift silently and in the direction that hurts most: renaming an
 * input in `action.yml` without updating the `ActionInput` call leaves a
 * perfectly type-correct action that reads an input nobody supplies and
 * quietly takes the default. There is no compile error and no runtime error —
 * just wrong behavior.
 *
 * These tuples are the middle term that makes the mismatch checkable.
 * `__test__/action-contract.test.ts` asserts a three-way agreement between
 * this module, `action.yml`, and the source that actually performs the reads
 * and writes, so a rename has to land in all three or fail the suite.
 *
 * This module is deliberately dependency-free — it is a description of the
 * contract, not a participant in it.
 */

/**
 * Every input declared in `action.yml`.
 *
 * @remarks
 * Order follows the manifest for reviewability; the test compares as sets, so
 * reordering is safe.
 */
export const INPUT_NAMES = [
	"name",
	"url",
	"path",
	"sha",
	"json",
	"mode",
	"base-branch",
	"branch",
	"commit-message",
	"pr-title",
	"pr-body",
	"auto-merge",
	"dry-run",
	"app-client-id",
	"app-private-key",
] as const;

/** Every output declared in `action.yml`. */
export const OUTPUT_NAMES = [
	"result",
	"status",
	"changed",
	"mode",
	"commit-sha",
	"commit-url",
	"pr-number",
	"pr-url",
	"plugins-updated",
] as const;

/** An input name, narrowed to the declared set. */
export type InputName = (typeof INPUT_NAMES)[number];

/** An output name, narrowed to the declared set. */
export type OutputName = (typeof OUTPUT_NAMES)[number];

/**
 * The inputs whose `action.yml` default is something other than `""`.
 *
 * @remarks
 * Only these are worth mirroring. An omitted input arrives as `""` regardless
 * of whether the manifest says so, and `inputs.ts` maps `""` to "missing"
 * uniformly — so an empty default carries no information a reader needs here.
 * A *non-empty* default is different: it is a real behavioral decision that
 * previously existed twice, once in the manifest and once as a literal in
 * `inputs.ts`, with nothing keeping the two honest.
 *
 * `dry-run` is spelled as the manifest's string; `inputs.ts` reads it through
 * `ActionInput.boolean` and the test asserts the two agree once parsed.
 */
export const INPUT_DEFAULTS = {
	mode: "commit",
	branch: "chore/repin-plugins",
	"auto-merge": "rebase",
	"dry-run": "false",
} as const satisfies Partial<Record<InputName, string>>;
