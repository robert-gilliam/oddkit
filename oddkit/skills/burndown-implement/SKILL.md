---
name: burndown-implement
description: >
  Run an autonomous burndown session set up by /oddkit:burndown-plan. Reads the session
  index, validates each issue's tracking and answered clarifications, then ships PRs in
  parallel without further human intervention. Use when the user has answered the
  clarifying-questions files and wants to ship the work — "run the burndown",
  "implement the burndown", "ship the planned issues", or "/oddkit:burndown-implement".
  Auto-resumes interrupted sessions; failed issues never block others.
argument-hint: "[--session <session-id>]"
model: sonnet
---

# Burndown — Implement

Half two of the autonomous burndown flow. Picks up the session that `/oddkit:burndown-plan`
created, validates that every issue is ready, then fans out implementation agents — one
worktree per issue, one PR per issue — and posts a result comment to each. No realtime
questions. Fully resumable.

**Why autonomous.** All decisions live in the per-issue tracking JSON and the answered
clarifying-questions files. If any issue is missing tracking or has unanswered questions,
that one issue is skipped and reported. The rest run.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

**Model strategy.** Orchestrator is sonnet. Pass `model:` explicitly on every Agent call:
- plan generation → sonnet
- simple-issue implementation → sonnet
- complex-issue implementation → opus
- `@oddkit:intent-checker` (within impl agents) → opus (its default)

## Parse arguments

From `$ARGUMENTS`:
- **`--session <session-id>`** (optional): pick a specific session by ID. If omitted,
  auto-discover.

## Phase 1 — Locate the session

State lives in the developer's current repo's `.oddkit/`. From their current directory:
```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
SESSIONS_DIR="$MAIN_REPO/.oddkit/burndown-sessions"
```

If `--session <id>` was provided, the index is `$SESSIONS_DIR/<id>.md`. Verify it exists.

Otherwise auto-discover: list `$SESSIONS_DIR/*.md`, parse each frontmatter `status`, and
pick the newest whose status is not `complete`. If all sessions are `complete`, pick the
most recent regardless and announce it clearly.

If `$SESSIONS_DIR` is empty or missing: tell the developer to run `/oddkit:burndown-plan`
first. Exit.

If multiple plausible matches with no `--session`: pick the most recent and announce it
so the developer can override with `--session`.

Read `main_repo` and `session_worktree` from the index frontmatter. The session worktree
may or may not still exist (it's a plan-time artifact); implement doesn't depend on it.

## Phase 2 — Read the session index and validate

Parse the YAML frontmatter to get the issue list, base branch, session id, etc. Set the
index `status` to `in_progress` (atomic write).

For each issue listed:

### 2a. Verify tracking file exists

```bash
test -f "$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>.json"
```

If missing: log a `skipped: missing-tracking` outcome for this issue and continue. The
issue is dropped from this run. The final report calls it out.

### 2b. Read tracking; respect terminal phases

Load `<n>.json`. If `phase` is one of `done`, `failed`, `blocked`, `already_done`, the
issue is in a terminal state from a previous run. Skip work for it; the final report
includes its status.

### 2c. Validate clarifications (when `needs_clarifications: true`)

If the tracking file says clarifications are needed, read the file at
`$MAIN_REPO/<clarifications_file>` (the field is relative to `$MAIN_REPO`). Parse every
`### Q` block; each must be followed by a non-empty `[Answer]:` line. "Non-empty" means
there's something other than whitespace after the colon — including `agent's call`, prose,
a letter, anything.

If any answer is blank: skip this issue with outcome `skipped: unanswered-questions:
Q<n>, Q<m>` and continue. Don't repair; the developer must answer and re-run.

If all answers present: update the clarifications file's frontmatter `status: answered`,
update tracking `phase: "ready"`, and proceed.

### 2d. Resume detection

If `phase` is `implementing` or `implementation_complete`, a previous run was interrupted
mid-flight. Treat as ready-to-implement and re-spawn the impl agent — the agent should
detect the existing worktree and continue.

After Phase 2, you have three buckets:
- **Skipped** (will report at the end, no work done)
- **Already done** (will post evidence comments only)
- **To implement** (real work this run)

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
- **Already done**: post evidence comment (see `references/comments.md`). Set
  `phase: "already_done"`, `comment_posted: true`. No worktree, no agent.

### Per-issue worktree path

Before spawning impl agents, refresh the base:
```bash
git -C "$MAIN_REPO" fetch origin "$BASE_BRANCH"
```

Each implementation agent creates its own worktree at:
```
$MAIN_REPO/.oddkit/worktrees/burndown-<session-id>-issue-<n>
```

Branch name: `burndown/issue-<n>-<slug>`. Branch off `origin/<base_branch>` (from
tracking), except in serialized chains where it's the predecessor's branch.

### Spawning impl agents

For each issue to implement, spawn an Agent using `references/impl-handoff.md`.
**Model:** `sonnet` for `simple`, `opus` for `complex`. Always pass
`mode: "bypassPermissions"` — this is the unattended phase.

When the agent returns, parse its structured response and write the result fields into
the tracking file:
- `phase`: `done` | `failed` | `implementation_complete` (if push happened but PR open
  failed)
- `implementation_complete`: true if code+tests done locally
- `pushed_to_github`: true if branch pushed AND PR opened
- `pr_url`, `branch`, `worktree`, `tests_status`, `plan_compliance`, `summary`,
  `caveats`, `failure_reason`

Write the file immediately after each return — don't batch. Resumability depends on this.

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

On success: set `comment_posted: true` and `updated_at`.

## Phase 6 — Finalize and report

Update the index frontmatter `status: complete` (atomic write).

Print:

```
## Burndown complete — session <session-id>

### Shipped ({M})
- #123 → <PR URL> — tests <pass|fail|skipped>, plan compliance <pass|fail|n/a>

### Already complete ({P})
- #789 — evidence comment posted

### Failed ({K})
- #456 — <one-line failure reason>. Worktree: <abs path>

### Blocked ({L})
- #790 — predecessor #789 failed

### Skipped ({Q}) — not run this round
- #100 — missing tracking file
- #101 — unanswered questions: Q1, Q3 — fix the file and re-run

### Comments that didn't post ({R})
- #555 — <reason>. Hand-post: gh issue comment 555 \
    --body-file $MAIN_REPO/.oddkit/burndown-comments-pending/555.md

### Next steps
- Review PRs (consider /oddkit:review <PR>)
- Address skips by editing the relevant files, then re-run
  /oddkit:burndown-implement (resumes automatically)
- For failures: cd into the issue's worktree and inspect; re-run when ready
```

Don't auto-clean per-issue worktrees. Failed/blocked issues need them for inspection.
Cleanup hint: `git worktree remove <worktree>` after a PR is merged or a failure is
diagnosed.

## Resume semantics

The session is fully resumable. Re-running `/oddkit:burndown-implement` on the same
session:
- Reads each tracking file and respects terminal phases (`done`, `failed`, `blocked`,
  `already_done`) — those issues are skipped this run.
- Picks up `awaiting_clarifications` issues only if their answers have since been
  filled in.
- Re-spawns impl agents for issues stuck at `implementing` or `implementation_complete`.
  The agent must detect an existing worktree and continue from current branch state.
- For failed issues that the developer wants to retry, instruct them to set the issue's
  `phase` back to `ready` and clear `failure_reason` in the tracking file. Then re-run.
  (No `--retry` flag — keep the surface area small; editing the tracking file is the
  retry mechanism.)

## Notes for the implementer

- **State is rooted at `$MAIN_REPO/.oddkit/`.** Tracking, descriptions, clarifications,
  plans, comments-pending, and the session index all live there. Use absolute paths in
  every agent prompt.
- Use `cwd:` / `git -C <path>` instead of `cd` in compound shell commands.
- Per-issue worktrees branch from `origin/<base_branch>` (refreshed via `git fetch`) by
  default. Serialized chain dependents branch from the predecessor's branch.
- A new worktree may need `pnpm install` / `npm install` / etc. The impl agent detects
  the lockfile and runs install before tests if needed.
- Independence is sacred. One issue's failure must never derail another. Only serialized
  chain dependents are blocked when their predecessor fails.
- Stacked PRs: don't auto-retarget on merge. Leave it as a manual step in the report.
- File-overlap detection from plan time is heuristic. Real conflicts at PR time are the
  developer's call.
