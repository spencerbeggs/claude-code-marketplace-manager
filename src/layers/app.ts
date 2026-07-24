/**
 * Application layer composition.
 *
 * Wires library layers for the pre/main/post phases together.
 *
 * @module layers/app
 */

import { NodeFileSystem, NodeServices } from "@effect/platform-node";
import {
	ActionStateLive,
	GitBranchLive,
	GitCommitLive,
	GitHubAppLive,
	GitHubGraphQLLive,
	GitHubToken,
	OctokitAuthAppLive,
	PullRequestLive,
} from "@savvy-web/github-action-effects";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

/** pre/post: GitHubApp for provision/dispose + filesystem for ActionState. */
export const PreLive = Layer.mergeAll(
	GitHubAppLive.pipe(Layer.provide(OctokitAuthAppLive), Layer.provide(FetchHttpClient.layer)),
	NodeFileSystem.layer,
);
export const PostLive = PreLive;

/**
 * main: the installation token provisioned in pre is read back via
 * GitHubToken.client() (Layer.orDie — a missing token is a wiring defect) and
 * the git services are built from that client. NodeServices provides FileSystem
 * (manifest read) and backs ActionState.
 */
const actionState = ActionStateLive.pipe(Layer.provide(NodeServices.layer));
const githubClient = GitHubToken.client().pipe(Layer.provide(actionState), Layer.orDie);
// PullRequestLive requires GitHubClient | GitHubGraphQL (confirmed:
// layers/PullRequestLive.ts:94), so its own GitHubGraphQL dependency is built
// from the same client and merged in alongside it.
const ghGraphql = GitHubGraphQLLive.pipe(Layer.provide(githubClient));

export const MainLive = Layer.mergeAll(
	githubClient,
	GitCommitLive.pipe(Layer.provide(githubClient)),
	GitBranchLive.pipe(Layer.provide(githubClient)),
	PullRequestLive.pipe(Layer.provide(Layer.merge(githubClient, ghGraphql))),
	NodeServices.layer,
);
