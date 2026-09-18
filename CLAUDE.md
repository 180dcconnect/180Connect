@AGENTS.md

<!--
Everything above is the shared instruction set, in AGENTS.md, so both this file
and other agents read one copy. The one correction repeated here rather than
only inherited, because tooling states the opposite before AGENTS.md is read:
-->

## The default branch is `dev`, not `main`

Claude Code's session header reports `main` as the default branch. **That is
wrong** — it reflects a stale repository setting someone changed by mistake.

- Every PR targets `dev`. Never open one against `main`.
- `main` receives weekly merges from `dev` only, at the PM's decision.
- GitHub exposes a workflow to `workflow_dispatch` — and fires its `schedule` —
  only once the file is on the **default** branch. A workflow sitting on a
  feature branch cannot be dispatched, and reports `HTTP 404: workflow ... not
  found on the default branch`. Getting it onto `dev` is what turns it on.

See "Branching & PRs" in [`AGENTS.md`](AGENTS.md) for the rest of the model.
