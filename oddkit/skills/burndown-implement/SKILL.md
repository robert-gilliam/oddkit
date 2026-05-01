---
name: burndown-implement
description: >
  Ship every burndown issue that's ready: scans .oddkit/burndown-issue-tracking/, picks
  any non-terminal issue with answers filled in (or no questions needed), opens a PR per
  issue, and posts result comments — without further human intervention. Use when the
  developer has answered the clarifying-questions files and wants to ship the work — "run
  the burndown", "implement the burndown", "ship the planned issues", or
  "/oddkit:burndown-implement". Auto-resumes interrupted issues; failed issues never
  block others.
model: sonnet
---

# Burndown — Implement

Half two of the autonomous burndown flow. Scans the developer's burndown tracking files,
picks any issue whose preconditions are met, then fans out implementation agents — one
worktree per issue, one PR per issue — and posts a result comment to each. No realtime
questions. Fully resumable.

**Why autonomous.** All decisions live in the per-issue tracking JSON and the answered
clarifying-questions files. If an issue isn't ready (unanswered questions, incomplete
plan), it's left alone and noted in the final report. The rest run.

**No session coupling.** There's no session index file and no `--session` flag. State is
in `$MAIN_REPO/.oddkit/burndown-issue-tracking/`; this skill scans it and works with
whatever's there. The developer can run `/oddkit:burndown-plan` multiple times across
different issue sets — implement picks up everything that's ready, regardless of when it
was planned.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

**Model strategy.** Orchestrator is sonnet. Pass `model:` explicitly on every Agent call:
- plan generation → sonnet
- simple-issue implementation → sonnet
- complex-issue implementation → opus
- `@oddkit:intent-checker` (within impl agents) → opus (its default)

## Phase 1 — Scan tracking files and triage

State lives in the developer's current repo's `.oddkit/`. From their current directory:
```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
TRACKING_DIR="$MAIN_REPO/.oddkit/burndown-issue-tracking"
```

If `$TRACKING_DIR` is missing or empty: tell the developer to run
`/oddkit:burndown-plan` first. Exit.

List `$TRACKING_DIR/*.json`. For each tracking file, decide what to do based on `phase`:

- **Terminal** (`done`, `failed`, `blocked`, `already_done`): leave alone. Not part of
  this run, not in the report.
- **`awaiting_clarifications`**: read the file at `$MAIN_REPO/<clarifications_file>` (the
  field is relative to `$MAIN_REPO`). Parse every `### Q` block; each must be followed by
  a non-empty `[Answer]:` line. "Non-empty" = anything other than whitespace after the
  colon — `agent's call`, prose, a letter, anything counts.
  - All answered → flip `phase: "ready"` in tracking, then include in this run.
  - Any blank → record as **skipped (unanswered)** with the question numbers, and move
    on. Don't touch the clarifications file. The `[Answer]:` lines are the source of
    truth; there's no separate status to update.
- **`ready`**: include in this run.
- **`implementing` or `implementation_complete`**: a previous run was interrupted. Treat
  as ready-to-implement and re-spawn the impl agent — it should detect the existing
  worktree and continue.
- **`pending` or `reconned`**: plan didn't finish for this issue. Record as **skipped
  (incomplete plan)** and move on. To recover, the developer deletes the tracking file
  and re-runs /oddkit:burndown-plan.

After this scan you have:
- **Run set** — issues this implement run will touch (`ready`, `implementing`,
  `implementation_complete`)
- **Skipped (unanswered)** — reported at end
- **Skipped (incomplete plan)** — reported at end

Reporting in Phase 6 only covers the run set plus the skipped lists above. Issues
already in terminal phases from prior runs don't show up.

Read `base_branch` from each tracking file (plan recorded it during Phase 3).

## Phase 3 — Generate plans for complex issues

For each `complex` issue with no `plan_file` set, spawn a plan-generation Agent — see
`references/plan-handoff.md`. **`model: sonnet`**. Run all plan generations in parallel
in one message.

Each agent writes its plan to `$MAIN_REPO/.oddkit/burndown-plans/<n>.plan.md`. After it
returns, update the tracking file: set `plan_file` to that path. `phase` stays `ready`.

Simple issues skip planning — implemented directly from issue + recon + clarifications.

## Phase 4 — Fan out implementation

The orchestrator never asks the developer anything from this point on. Each impl agent
owns its issue end-to-end. Failures are isolated: an issue that fails reports back, but
parallel siblings keep running.

### Cohorts

- **Parallel cohort**: issues with no `blocked_by`. Fire all in one message (multiple
  Agent calls). Wait for all to return before moving on.
- **Serialized chains**: issues with `blocked_by`. Fire the head; when it succeeds, fire
  the next with the predecessor's branch as `<base>`. If the head fails, mark every
  dependent as `phase: "blocked"`, set their tracking accordingly, and skip — don't
  propagate a broken base.
- **Already done**: post evidence comment (see `references/comments.md`). Phase is
  already `already_done` from plan; no worktree, no agent. Skip to Phase 5.

### Per-issue worktree path

Before spawning impl agents, refresh the base:
```bash
git -C "$MAIN_REPO" fetch origin "$BASE_BRANCH"
```

Each implementation agent creates its own worktree at:
```
$MAIN_REPO/.oddkit/worktrees/burndown-issue-<n>
```

Branch name: `burndown/issue-<n>-<slug>`. Branch off `origin/<base_branch>` (from
tracking), except in serialized chains where it's the predecessor's branch.

### Spawning impl agents

For each issue to implement, spawn an Agent using `references/impl-handoff.md`.
**Model:** `sonnet` for `simple`, `opus` for `complex`. Always pass
`mode: "bypassPermissions"` — this is the unattended phase.

When the agent returns, parse its structured response and write the result fields into
the tracking file:
- `phase`: `done` (pushed + PR opened) | `failed` | `implementation_complete` (code+tests
  passed locally but push or PR open failed; this is a resume target)
- `pr_url`, `branch`, `worktree`, `tests_status`, `plan_compliance`, `summary`,
  `caveats`, `failure_reason`

Don't add boolean shortcut fields. `phase` plus the explicit results above is enough.

Write the file immediately after each return — don't batch. Resumability depends on this.

### Clean up successful worktrees

Right after writing `phase: "done"`, remove that issue's worktree:

```bash
git -C "$MAIN_REPO" worktree remove --force "<worktree-path>"
```

The branch is on origin and the PR is open — there's nothing further to inspect locally.
For `failed` and `blocked` issues, **leave the worktree in place** so the developer can
inspect what went wrong. For serialized chains, only clean up after the chain is fully
done (the dependent agent reads the predecessor's branch name from tracking and pulls
from origin, so the predecessor's worktree isn't needed once it's pushed).

### Archive clarifications on done

Also right after writing `phase: "done"`, move the issue's clarifications file out of
the active directory:

```bash
mv -f "$MAIN_REPO/<clarifications_file>" \
      "$MAIN_REPO/.oddkit/burndown-archive-clarifying-questions/<n>.md"
```

(`<clarifications_file>` from tracking; skip when it's `null`.) This keeps
`.oddkit/burndown-clarifying-questions/` showing only outstanding work — answered files
for shipped issues move to the archive. For `failed` and `blocked`, **leave the
clarifications file in place** so a retry has the answers ready. `already_done` issues
have no clarifications file.

If a file with the same name already exists in the archive (rare — only happens after a
re-plan + re-ship cycle on the same issue), `mv -f` overwrites it. The most recent
shipped version is what matters.

## Phase 5 — Post resolution comments

The orchestrator (you) posts every comment. Never the impl agent. This keeps formatting
consistent and gives a single retry path.

For each issue, after its terminal state is recorded, post the matching template from
`references/comments.md`:
- `done` → "PR opened" comment
- `failed` → "could not complete" comment
- `blocked` → "skipped (blocked)" comment
- `already_done` → "already complete" comment

If `gh issue comment` fails (network/auth), set `comment_error: <reason>` on the
tracking file, write the intended body to
`$MAIN_REPO/.oddkit/burndown-comments-pending/<n>.md`, and continue. Don't retry inside
the same run.

`comment_error: null` (and the absence of a pending comment file) is the implicit signal
that the comment posted. No separate `comment_posted` flag.

## Phase 6 — Finalize and report

Print, scoped to issues this run actually touched:

```
## Burndown complete — <YYYY-MM-DD HH:mm UTC>

### Shipped ({M})
- #123 → <PR URL> — tests <pass|fail|skipped>, plan compliance <pass|fail|n/a>

### Already complete ({P})
- #789 — evidence comment posted

### Failed ({K})
- #456 — <one-line failure reason>. Worktree retained: <abs path>

### Blocked ({L})
- #790 — predecessor #789 failed

### Skipped — unanswered ({Q})
- #100 — Q1, Q3 unanswered. File: .oddkit/burndown-clarifying-questions/100.md

### Skipped — incomplete plan ({R})
- #101 — phase: pending. Delete the tracking file and re-run /oddkit:burndown-plan.

### Comments that didn't post ({S})
- #555 — <reason>. Hand-post: gh issue comment 555 \
    --body-file $MAIN_REPO/.oddkit/burndown-comments-pending/555.md

### Next steps
- Review PRs (consider /oddkit:review <PR>)
- Address skips per the instructions above, then re-run /oddkit:burndown-implement
- For failures: cd into the issue's worktree and inspect; re-run when ready
```

Omit any section that has zero entries — keep the report dense.

## Resume semantics

Implement is fully resumable. Re-running it:
- Reads each tracking file and respects terminal phases (`done`, `failed`, `blocked`,
  `already_done`) — those issues are skipped this run.
- Picks up `awaiting_clarifications` issues only if their answers have since been
  filled in.
- Re-spawns impl agents for issues stuck at `implementing` or `implementation_complete`.
  The agent must detect an existing worktree and continue from current branch state.
- For failed issues the developer wants to retry: set `phase` back to `ready` and clear
  `failure_reason` in the tracking file, then re-run. (No `--retry` flag — editing the
  tracking file is the retry mechanism.)

## Notes for the implementer

- **State is rooted at `$MAIN_REPO/.oddkit/`.** Tracking, descriptions, clarifications,
  plans, comments-pending. Use absolute paths in every agent prompt. There's no session
  index file — implement scans tracking JSON.
- Use `cwd:` / `git -C <path>` instead of `cd` in compound shell commands.
- Per-issue worktrees branch from `origin/<base_branch>` (refreshed via `git fetch`) by
  default. Serialized chain dependents branch from the predecessor's branch.
- A new worktree may need `pnpm install` / `npm install` / etc. The impl agent detects
  the lockfile and runs install before tests if needed.
- Independence is sacred. One issue's failure must never derail another. Only serialized
  chain dependents are blocked when their predecessor fails.
- `phase` is the only state field. Don't add `pushed_to_github`, `comment_posted`,
  `implementation_complete` boolean shortcuts — derive from `phase`, `pr_url`, and
  `comment_error`.
- Stacked PRs: don't auto-retarget on merge. Leave it as a manual step in the report.
- File-overlap detection from plan time is heuristic. Real conflicts at PR time are the
  developer's call.
