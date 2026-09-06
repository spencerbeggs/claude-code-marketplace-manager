import { assert, describe, it } from "@effect/vitest";
import { GitHubApp, InstallationToken } from "@effected/github";
import type { ActionStateShape } from "@effected/github-actions";
import { ActionState } from "@effected/github-actions";
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
import { post } from "../src/post.js";
import { STATE_KEYS } from "../src/state.js";

// The key `GitHubToken` persists under by default. Spelled out because these
// tests must distinguish the token read (performed by `dispose`) from the
// start-time read (performed by `post` itself) inside a single `getOptional`
// stub — the distinction is the whole point of the ordering test below.
const TOKEN_KEY = "githubToken";

/**
 * Stub `getOptional`, keyed by state key.
 *
 * @remarks
 * The cast is unavoidable rather than lazy. `getOptional` is generic in the
 * decoded type — `<A, I>(key, schema) => Effect<Option<A>, ...>` — because the
 * real implementation decodes whatever schema it is handed. A stub returns one
 * concrete type, which cannot satisfy a universally-quantified `A`, so no
 * honestly-typed stub of this member exists. Casting to the member's own type
 * keeps the lie as small and as visible as possible: the parameter and return
 * shapes are still checked, only the quantifier is bypassed.
 */
const stubGetOptional = (f: (key: string) => Effect.Effect<Option.Option<unknown>>): ActionStateShape["getOptional"] =>
	f as unknown as ActionStateShape["getOptional"];

const liveToken = InstallationToken.make({
	token: Redacted.make("ghs_live"),
	expiresAt: DateTime.fromDateUnsafe(new Date(Date.now() + 60 * 60 * 1000)),
	installationId: 1,
	permissions: { contents: "write" },
});

interface Harness {
	readonly revoked: Array<string>;
	readonly layer: Layer.Layer<GitHubApp | ActionState>;
}

/**
 * `post` wired to a live token, with the start-time read under the caller's
 * control.
 *
 * @param startTime how the `start-time` read behaves — the fault-injection point.
 */
const harness = (startTime: () => Effect.Effect<Option.Option<never>, never, never>): Harness => {
	const revoked: Array<string> = [];
	const layer = Layer.mergeAll(
		GitHubApp.layerTest({
			revoke: (token) =>
				Effect.sync(() => {
					revoked.push(Redacted.value(token));
				}),
		}),
		ActionState.layerTest({
			getOptional: stubGetOptional((key) => (key === TOKEN_KEY ? Effect.succeed(Option.some(liveToken)) : startTime())),
		}),
	);
	return { revoked, layer };
};

describe("post", () => {
	it.effect("revokes the installation token", () =>
		Effect.gen(function* () {
			const h = harness(() => Effect.succeed(Option.none()));
			yield* post.pipe(Effect.provide(h.layer));
			assert.deepStrictEqual(h.revoked, ["ghs_live"]);
		}),
	);

	// The security invariant, which until now was pinned by prose only: a live
	// installation token left un-revoked is a leak, so revocation must not be
	// displaceable by anything else in this phase.
	//
	// The start-time read is made to *die* rather than fail typed, and that
	// choice is what gives the test teeth. `post` wraps itself in
	// `catchDefect`, so a defect raised before revocation would be swallowed
	// and the phase would report success having revoked nothing. Sequenced
	// correctly — revoke first — the defect cannot reach the token. This test
	// therefore fails if anyone reorders the two reads, which a typed failure
	// would not detect, since `post` already catches those.
	it.effect("revokes even when the duration read dies", () =>
		Effect.gen(function* () {
			const h = harness(() => Effect.die(new Error("state file vanished")));
			yield* post.pipe(Effect.provide(h.layer));
			assert.deepStrictEqual(h.revoked, ["ghs_live"], "revocation was displaced by the duration read");
		}),
	);

	it.effect("does not fail the run when revocation itself fails", () =>
		Effect.gen(function* () {
			const layer = Layer.mergeAll(
				GitHubApp.layerTest({ revoke: () => Effect.die(new Error("GitHub is down")) }),
				ActionState.layerTest({
					getOptional: stubGetOptional((key) =>
						key === TOKEN_KEY ? Effect.succeed(Option.some(liveToken)) : Effect.succeed(Option.none()),
					),
				}),
			);
			// The contract is that this phase cannot fail the run on the way out.
			yield* post.pipe(Effect.provide(layer));
		}),
	);

	it.effect("is a no-op when pre never provisioned a token", () =>
		Effect.gen(function* () {
			const revoked: Array<string> = [];
			const layer = Layer.mergeAll(
				GitHubApp.layerTest({
					revoke: (token) =>
						Effect.sync(() => {
							revoked.push(Redacted.value(token));
						}),
				}),
				ActionState.layerTest({ getOptional: stubGetOptional(() => Effect.succeed(Option.none())) }),
			);
			yield* post.pipe(Effect.provide(layer));
			assert.lengthOf(revoked, 0);
		}),
	);

	it("reads the start time under the key pre writes", () => {
		// Cheap guard on the pair: the two phases agree only by sharing this
		// constant, and a rename on one side alone is silent.
		assert.strictEqual(STATE_KEYS.startTime, "start-time");
	});
});
