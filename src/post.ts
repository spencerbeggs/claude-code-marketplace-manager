import { Action, ActionState, GitHubToken } from "@effected/github-actions";
import { Effect, Option } from "effect";
import { PostLive } from "./layers/app.js";
import { STATE_KEYS, StartTimeState } from "./state.js";

/**
 * post: revoke the GitHub App installation token, then best-effort report the
 * run duration.
 *
 * @remarks
 * Revocation runs **first** and is unconditional — it must not be skippable by
 * a typed failure elsewhere in this phase, because a live installation token
 * left un-revoked is a security-relevant leak. The duration read (which can
 * itself fail with a typed `ActionStateError`) is therefore sequenced *after*
 * revocation and carries its own catch so it can never displace it. There is no
 * opt-out.
 *
 * The kit's `dispose` is already forgiving in the two shapes that matter: it
 * reads the token with `getOptional`, so a `post` running after a `pre` that
 * never got as far as provisioning is a no-op rather than a failure, and it
 * skips revoking an already-expired token, which GitHub has stopped accepting
 * anyway. The belt-and-braces `catch` below stays regardless — the invariant is
 * that this phase cannot fail the run on the way out.
 */
export const post = Effect.gen(function* () {
	yield* Effect.logInfo("Revoking GitHub App installation token...");
	yield* GitHubToken.dispose().pipe(
		Effect.catch((e) => Effect.logWarning(`Token revocation failed: ${e instanceof Error ? e.message : String(e)}`)),
	);

	const state = yield* ActionState;
	const startState = yield* state
		.getOptional(STATE_KEYS.startTime, StartTimeState)
		.pipe(Effect.catch(() => Effect.succeed(Option.none())));
	if (Option.isSome(startState)) {
		const duration = Date.now() - startState.value.startedAt;
		yield* Effect.logInfo(`Marketplace-manager completed in ${(duration / 1000).toFixed(2)}s`);
	}
}).pipe(
	Effect.catchDefect((d) => Effect.logWarning(`Post-action warning: ${d instanceof Error ? d.message : String(d)}`)),
);

/* v8 ignore next 3 */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(post, { layer: PostLive });
}
