---
"claude-code-marketplace-manager": patch
---

## Bug Fixes

* `land` now refuses `pr` mode when `base` and `branch` are the same. Previously nothing stopped the two from colliding, and the single `GitBranch.upsert` would move the *base* branch itself onto the new commit — landing an unreviewed change directly on it, with the pull request call only failing afterward on a head equal to its base. The guard runs before the commit is built, so `land`'s error channel now also includes `InvalidInputError`. `commit` mode is unaffected — it never reads `branch`.
