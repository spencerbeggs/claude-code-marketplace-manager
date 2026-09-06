/**
 * Global Vitest setup
 * Runs once before all test files
 *
 * @remarks
 * Strips the GitHub Actions runner environment before any worker is forked.
 *
 * This is load-bearing on a runner, where `ci:test` itself executes with
 * `GITHUB_ACTIONS=true` and the full `INPUT_*` set exported. Two things go
 * wrong without it:
 *
 * - `src/pre.ts`, `src/main.ts` and `src/post.ts` each end in an
 *   `if (process.env.GITHUB_ACTIONS)` entry guard that runs the real phase as
 *   an import side effect. Any test that imports an entry point to exercise it
 *   would, on CI only, mint and revoke a real installation token instead.
 * - `ActionInput` reads inputs from the mangled `INPUT_*` variables, so a
 *   leaked runner value would silently stand in for a fixture and make a test
 *   pass for the wrong reason.
 *
 * `globalSetup` runs in the Vitest host process before the `forks` pool spawns
 * any worker, and forked workers inherit `process.env` as it stands at fork
 * time — so deleting here reaches every test file. `__test__/env.test.ts`
 * asserts that propagation actually holds rather than trusting it.
 */

/** Runner variables removed wholesale before any worker is forked. */
const RUNNER_VARS = [
	"GITHUB_ACTIONS",
	"GITHUB_TOKEN",
	"GITHUB_OUTPUT",
	"GITHUB_STATE",
	"GITHUB_ENV",
	"GITHUB_PATH",
	"GITHUB_STEP_SUMMARY",
] as const;

/**
 * Prefixes whose every variable is removed: `INPUT_*` are the mangled action
 * inputs and `STATE_*` the cross-phase state slots.
 */
const RUNNER_PREFIXES = ["INPUT_", "STATE_"] as const;

export function setup(): void {
	for (const key of RUNNER_VARS) {
		delete process.env[key];
	}
	for (const key of Object.keys(process.env)) {
		if (RUNNER_PREFIXES.some((prefix) => key.startsWith(prefix))) {
			delete process.env[key];
		}
	}
}

/**
 * Global Vitest teardown
 * Runs once after all test files
 *
 * @remarks
 * Currently empty
 */
export function teardown(): void {}
