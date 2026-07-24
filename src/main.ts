import { Action } from "@savvy-web/github-action-effects";
import { MainLive } from "./layers/app.js";
import { program } from "./program.js";

/* v8 ignore next */
Action.run(program, { layer: MainLive });
