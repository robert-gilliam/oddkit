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
argument-hint: "[--yolo]"
model: sonnet
---

# Burndown — Implement

Half two of the autonomous burndown flow. Scans the developer's burndown tracking files,
picks any issue whose preconditions are met, then fans out implementation agents — one
worktree per issue, one PR per issue — and posts a result comment to each. No realtime
questions. Fully resumable.

## Parse arguments

From `$ARGUMENTS`:
- **`--yolo`** (optional): fully autonomous mode. Skips the one human prompt this skill
  has (Phase 1's in-progress re-spawn question) by using its default of "No, don't
  re-spawn." Set automatically when invoked from `/oddkit:burndown-ship`. Default is
  Off — i.e., the skill prompts as documented below.

Unknown args are ignored (this skill takes no positional arguments).

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
- plan generation → opus (one agent per complex issue, and the plan determines
  everything downstream — this is the wrong place to save tokens)
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

Refresh all refs from origin so per-issue worktrees branch off current remote state, not
stale local refs. One fetch covers every `base_branch` recorded across tracking files:
```bash
git -C "$MAIN_REPO" fetch origin --prune
```

List `$TRACKING_DIR/*.json`. For each tracking file, decide what to do based on `phase`:

- **Terminal** (`done`, `failed`, `blocked`, `already_done`): leave alone. Not part of
  this run, not in the report.
- **`awaiting_clarifications`**: read the file at `$MAIN_REPO/<clarifications_file>` (the
  field is relative to `$MAIN_REPO`). Collect every `[Answer]:` line — from each `### Q`
  block and (if present) from the `## Base branch` section. All must be non-empty.
  "Non-empty" = anything other than whitespace after the colon — `agent's call`, prose,
  a letter, anything counts.

  - **Any blank** (including a blank Base branch answer) → record as **skipped
    (unanswered)** with the question identifiers (e.g. `Q1, Q3` or `Base branch`), and
    move on. Don't touch the clarifications file or the tracking file's `base_branch`.
    The `[Answer]:` lines are the source of truth; there's no separate status to update.
  - **All answered** → resolve and validate the Base branch first (see below), then
    only on success flip `phase: "ready"` and include in this run.

  **Resolving the Base branch answer.** Compute the would-be value, validate, then
  commit both writes atomically. Never half-update.

  Compute:
  - No `## Base branch` section in the file → use tracking's existing `base_branch`
    (what plan wrote). This case exists for clarifications files written before this
    section was introduced; new plans always include it.
  - Answer is `agent's call` (case-insensitive, exact phrase after trim) → use
    tracking's existing `base_branch`.
  - Anything else → strip whitespace; that's the candidate value.

  Validate the candidate against origin:
  ```bash
  git -C "$MAIN_REPO" rev-parse --verify "origin/<candidate>" >/dev/null 2>&1
  ```
  - Valid → write `base_branch: <candidate>` and `phase: "ready"` to tracking in a
    single atomic write. Include in this run.
  - Invalid → Before giving up, check whether this was a stacked PR whose base branch
    was merged and deleted. Query for a merged PR from that branch:
    ```bash
    gh pr list --state merged --head "<candidate>" --json baseRefName --limit 1
    ```
    If a merged PR is found, take its `baseRefName` as the new candidate and re-run the
    `rev-parse --verify` check against origin. If valid, write `base_branch: <parent>`
    and `phase: "ready"` to tracking and include in this run. The stacked base was
    merged; the parent is the correct target.

    If no merged PR is found, or the resolved parent also doesn't exist on origin →
    record as **skipped (invalid base branch)** with the value and the source
    (clarifications answer or plan-time default). Leave tracking untouched — phase
    stays `awaiting_clarifications` so the dev sees it as still-actionable.
- **`ready`**: include in this run.
- **`implementing`**: a previous run was interrupted mid-implementation — or another
  process is still running it right now. **Default: skip.** Re-spawning would race a
  live agent. Collect every `implementing` issue first, then before any fan-out (Phase
  3+) ask the developer **once** whether to re-spawn them — single batch prompt, default
  No. If the developer says no (or doesn't answer), record each as **skipped
  (in-progress)** and leave the tracking file untouched. If yes, include them in the run
  set; the impl agent will detect the existing worktree and continue.

  **Under `--yolo`:** skip the prompt entirely and use the default (No / don't re-spawn).
  Record every `implementing` issue as **skipped (in-progress)**. Rationale: a live
  agent race would corrupt state; the safe call is to leave them alone and let the
  developer resolve manually.
- **`implementation_complete`**: implementation finished but push or PR open failed.
  Re-spawn the impl agent — it will detect the existing worktree and retry the final
  steps. (No prompt: the work itself isn't in flight.)
- **`pending` or `reconned`**: plan didn't finish for this issue. Record as **skipped
  (incomplete plan)** and move on. To recover, the developer deletes the tracking file
  and re-runs /oddkit:burndown-plan.

After this scan you have:
- **Run set** — issues this implement run will touch (`ready`,
  `implementation_complete`, plus any `implementing` the developer opted in to)
- **Skipped (in-progress)** — `implementing` issues the developer did not opt to
  re-spawn; reported at end
- **Skipped (unanswered)** — reported at end
- **Skipped (invalid base branch)** — reported at end
- **Skipped (incomplete plan)** — reported at end

Reporting in Phase 5 only covers the run set plus the skipped lists above. Issues
already in terminal phases from prior runs don't show up.

After the scan, each run-set issue has its final `base_branch` set in tracking JSON —
either from plan's default or from the clarifications answer just resolved above.

## Phase 2 — Generate plans for complex issues

For each `complex` issue with no `plan_file` set, spawn a plan-generation Agent — see
`references/plan-handoff.md`. **`model: opus`**. Run all plan generations in parallel
in one message.

Each agent writes its plan to `$MAIN_REPO/.oddkit/burndown-plans/<n>.plan.md`. After it
returns, update the tracking file: set `plan_file` to that path. `phase` stays `ready`.

Simple issues skip planning — implemented directly from issue + recon + clarifications.

## Phase 3 — Fan out implementation

The only prompt in the whole flow is the in-progress re-spawn question from Phase 1.
From here on the orchestrator never asks the developer anything else. Each impl agent
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
  already `already_done` from plan; no worktree, no agent. Skip to Phase 4.

### Per-issue worktree path

Refs were refreshed in Phase 1, so every `origin/<base_branch>` is current. Each
implementation agent creates its own worktree at:
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

(`<clarifications_file>` from tracking.) When it's `null`, don't assume there was no
clarifications file — the impl agent may have dropped the field on a state write. Fall
back to the conventional path `.oddkit/burndown-clarifying-questions/<n>.md` and archive
it if it exists; only treat the issue as having no clarifications file when that path is
also absent. This keeps `.oddkit/burndown-clarifying-questions/` showing only outstanding
work — answered files for shipped issues move to the archive. For `failed` and `blocked`,
**leave the clarifications file in place** so a retry has the answers ready.
`already_done` issues have no clarifications file.

If a file with the same name already exists in the archive (rare — only happens after a
re-plan + re-ship cycle on the same issue), `mv -f` overwrites it. The most recent
shipped version is what matters.

## Phase 4 — Post resolution comments

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

## Phase 5 — Finalize and report

Print, scoped to issues this run actually touched:

```
## burndown-implement done — <YYYY-MM-DD HH:mm UTC>

### Shipped ({M})
- #123 → <PR URL> — tests <pass|fail|skipped>, plan compliance <pass|fail|n/a>

### Already complete ({P})
- #789 — evidence comment posted

### Failed ({K})
- #456 — <one-line failure reason>. Worktree retained: <abs path>

### Blocked ({L})
- #790 — predecessor #789 failed

### Skipped — in progress ({I})
- #321 — phase: implementing. Worktree: <abs path>. Re-run and approve the re-spawn
  prompt to resume, or set phase to `ready` in the tracking file.

### Skipped — unanswered ({Q})
- #100 — Q1, Q3 unanswered. File: .oddkit/burndown-clarifying-questions/100.md

### Skipped — invalid base branch ({B})
- #200 — base `feature-old` not on origin (from clarifications answer). Edit
  .oddkit/burndown-clarifying-questions/200.md and re-run.

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

**If invoked by burndown-ship:** when you printed `## burndown-implement done` you are
still in the same conversation that started burndown-ship. There is no separate
orchestrator to return to — you ARE burndown-ship, and burndown-ship's Phases 3–8
(classify, vet, review, feedback, CI gate, summary) are still ahead of you. Do not say
"handing off" or "returning to the parent." Your next action is burndown-ship's Phase 3.

## Resume semantics

Implement is fully resumable. Re-running it:
- Reads each tracking file and respects terminal phases (`done`, `failed`, `blocked`,
  `already_done`) — those issues are skipped this run.
- Picks up `awaiting_clarifications` issues only if their answers have since been
  filled in.
- For `implementing` issues, prompts the developer once before re-spawning (default:
  skip). This avoids racing a live agent that may still be running. Approving the
  prompt re-spawns the impl agent, which detects the existing worktree and continues.
- Re-spawns impl agents for issues stuck at `implementation_complete` without a prompt
  — the implementation finished, only the push/PR open needs retrying.
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
