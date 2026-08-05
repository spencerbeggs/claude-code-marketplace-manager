import { Action } from "@effected/github-actions";
import { MainLive } from "./layers/app.js";
import { program } from "./program.js";

/* v8 ignore next */
Action.run(program, { layer: MainLive });
