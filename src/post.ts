import { Action, ActionState, GitHubToken } from "@savvy-web/github-action-effects";
import { Effect, Option } from "effect";
import { PostLive } from "./layers/app.js";
import { STATE_KEYS, StartTimeState } from "./state.js";

/**
 * post: revoke the GitHub App installation token, then best-effort report the
 * run duration. Revocation runs FIRST and is unconditional — it must not be
 * skippable by a typed failure elsewhere in this phase (a live installation
 * token left un-revoked is a security-relevant leak), so the duration read
 * (which can itself fail with a typed `ActionStateError`) is sequenced after
 * revocation and has its own catch so it can never displace it.
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
