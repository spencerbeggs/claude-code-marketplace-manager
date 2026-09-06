import { describe, expect, it } from "vitest";

// Guards `vitest.setup.ts`. The stripping it does is only useful if it reaches
// the forked workers, and that propagation is an assumption about the pool
// rather than something Vitest promises in writing — so assert it from inside a
// worker. Locally these variables are absent anyway and this is vacuous; on a
// runner it is the only thing standing between the suite and a real phase
// execution, which is exactly where a silent regression would land.
describe("runner environment", () => {
	it("has GITHUB_ACTIONS stripped inside the worker", () => {
		expect(process.env.GITHUB_ACTIONS).toBeUndefined();
	});

	it("has no mangled INPUT_* variables leaking in as fixtures", () => {
		expect(Object.keys(process.env).filter((k) => k.startsWith("INPUT_"))).toEqual([]);
	});

	it("has no STATE_* cross-phase slots leaking in", () => {
		expect(Object.keys(process.env).filter((k) => k.startsWith("STATE_"))).toEqual([]);
	});
});
