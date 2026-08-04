/**
 * Application layer composition.
 *
 * Wires the `@effected` layers for the pre/main/post phases together.
 *
 * @module layers/app
 */

import { GitBranch, GitCommit, GitHubApp, GitHubRepository, PullRequest, Repo } from "@effected/github";
import { GitHubToken } from "@effected/github-actions";
import { Layer } from "effect";

/**
 * pre/post: minting and revoking the installation token.
 *
 * `GitHubApp.layer` requires nothing — it signs the app JWT itself. The three
 * layers this replaced (`GitHubAppLive` over `OctokitAuthAppLive` over
 * `FetchHttpClient.layer`) plus `NodeFileSystem.layer` all collapse into it:
 * `ActionRuntime.layer` already provides `FileSystem`, `HttpClient`,
 * `ActionState` and `ActionOutputs` to anything `Action.run` runs.
 */
export const PreLive = GitHubApp.layer;
export const PostLive = PreLive;

/**
 * The client built from the token `pre` provisioned.
 *
 * `Layer.orDie` because a missing or expired token in `main` is a wiring
 * defect, not a condition this action can act on — and because
 * `ActionRunOptions.layer` requires a `never` error channel.
 *
 * Bound to a `const` deliberately: `clientLayer()` is a parameterized factory
 * and layers memoize **by reference**, so calling it at each composition site
 * below would build four independent clients.
 */
const client = GitHubToken.clientLayer().pipe(Layer.orDie);

/**
 * The repository the resource services act on, from `GITHUB_REPOSITORY`.
 *
 * Provided as a layer, but every resource method still carries `Repo` in its
 * requirements and resolves it per call — which is what keeps `Repo.provide`
 * working for a scoped override rather than silently doing nothing.
 */
const repo = Repo.layerFromConfig().pipe(Layer.orDie);

/** main: the git resource services, each built from the one shared client. */
export const MainLive = Layer.mergeAll(
	GitCommit.layer.pipe(Layer.provide(client)),
	GitBranch.layer.pipe(Layer.provide(client)),
	PullRequest.layer.pipe(Layer.provide(client)),
	GitHubRepository.layer.pipe(Layer.provide(client)),
	repo,
);
