---
name: burndown-ship
description: >
  Fully autonomous burndown shipping pipeline. Implements every ready issue, vets the
  PRs it just created, then routes each — done if the vet comes back clean, address
  feedback for iffy small/medium PRs, deep review then address feedback for red ones or
  iffy-large. One command, walk away. Picks up where it left off if interrupted. Use
  when the developer has a planned burndown and wants to ship hands-off — "ship the
  burndown", "run the full burndown pipeline", "burndown end-to-end", "burndown to
  merge-ready", or "/oddkit:burndown-ship". Always pick this over running
  `/oddkit:burndown-implement` + manual review when the goal is hands-off shipping.
argument-hint: ""
model: sonnet
---

# Burndown — Ship

End-to-end orchestrator for the burndown loop. Wraps `/oddkit:burndown-implement`,
`/oddkit:vet-prs`, `/oddkit:review`, and `/oddkit:address-feedback` into one autonomous
pipeline. Every sub-skill is invoked with `--yolo`. No human prompts after kickoff.

**Always invoke sub-skills by their full `oddkit:` name** — pass the exact strings
`oddkit:burndown-implement`, `oddkit:vet-prs`, `oddkit:review`, `oddkit:address-feedback`
to the `Skill` tool. Other installed skills may share a word like "review," so when you
reach a phase, don't select by concept ("now I do the review") — copy the namespaced name
from that phase's invocation block. A bare `review` would silently run a different skill.

**Why one skill.** The four sub-skills already do the work — this one just sequences
them, scopes vetting to the PRs `burndown-implement` actually created (not pre-existing
opens), and routes each PR based on its vet verdict. Failure on one PR never blocks
another.

**Resumability.** Ship state for each issue lives **inside its existing tracking file**
as a `ship` sub-object. Re-running scans those files and picks up at the next
non-terminal `ship.phase`. A single transient file
(`$MAIN_REPO/.oddkit/burndown-ship-pending.json`) covers the brief window between
`burndown-implement` returning and ship-state being written, so a crash mid-classify is
recoverable.

**No new folders.** Everything lives in existing `.oddkit/` conventions: tracking files
get a `ship` field, vet-prs writes to its own `.oddkit/vet-prs/`, worktrees go under
`.oddkit/worktrees/`. The one transient file is deleted as soon as classification is
done.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

## You are the orchestrator — there is no other Claude

This skill runs entirely in your current context. The `Skill` tool loads sub-skill
instructions into THIS conversation — it does not spawn a separate agent or process.
When burndown-implement's instructions complete, you are still acting as burndown-ship.
The very next thing you do is Phase 3 of THIS skill.

There is no "handoff." There is no "returning to the orchestrator." Do not write
phrases like "handing off to burndown-ship orchestrator" or "returning to the parent
skill" — they describe a process boundary that does not exist. After writing
burndown-implement's final report, your immediate next action (same response or next
response, no break) is to start Phase 3.

## ship.phase state machine

Set on each issue's tracking file as `ship.phase`. `phase` (the burndown-implement
state) is untouched.

| Phase                       | Meaning                                                            | Next action                                  |
|-----------------------------|--------------------------------------------------------------------|----------------------------------------------|
| `needs_vet`                 | PR was opened this run; not yet triaged                            | Phase 4 — vet-prs                            |
| `vetted_clean` *(terminal)* | vet returned smell=clean + intent=✓                                | Done                                         |
| `needs_address_feedback`    | vet flagged iffy/⚠️/✗ at S/M scope                                  | Phase 6 — address-feedback                   |
| `needs_deep_review`         | vet flagged red, or iffy/⚠️/✗ at L scope                            | Phase 5 — review, then address-feedback      |
| `shipped` *(terminal)*      | All routing actions complete                                       | Done                                         |
| `ship_failed` *(terminal)*  | A sub-skill failed for this PR; other PRs not affected             | Surface in summary; manual recovery          |
| `ship_not_eligible` *(terminal)* | burndown-implement didn't produce a PR (failed/blocked/skipped) | Surface in summary; manual recovery          |

Companion fields on the `ship` object:
- `started_at` (iso utc) — when this issue entered the ship pipeline
- `vet_verdict` (`{scope, intent, smell}`) — written in Phase 4
- `vet_route` (`"done" | "feedback" | "review"`) — the routing decision in Phase 4
- `review_done_at` (iso utc) — set when Phase 5 completes for this PR
- `feedback_done_at` (iso utc) — set when Phase 6 completes for this PR
- `failure_reason` (string) — set if `ship.phase == "ship_failed"`

## Startup checklist

**Before touching any files or running any commands**, create a task for each phase so
you track remaining work and don't stop early:

```
TaskCreate: "burndown-ship Phase 2 — run burndown-implement"
TaskCreate: "burndown-ship Phase 3 — classify new PRs"
TaskCreate: "burndown-ship Phase 4 — vet PRs"
TaskCreate: "burndown-ship Phase 5 — deep review"
TaskCreate: "burndown-ship Phase 6 — address feedback"
TaskCreate: "burndown-ship Phase 7 — print summary"
```

Mark each task done only when that phase actually completes. **burndown-implement's
`## burndown-implement done` report is NOT your completion signal — it's just a line
of text you wrote inside the same conversation. You ARE burndown-ship, and you must
complete every phase through Phase 7 before this skill is done.**

## Phase 0 — Preflight

```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
TRACKING_DIR="$MAIN_REPO/.oddkit/burndown-issue-tracking"
PENDING_FILE="$MAIN_REPO/.oddkit/burndown-ship-pending.json"
RUN_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

If `$TRACKING_DIR` is missing or empty: tell the developer to run
`/oddkit:burndown-plan` first. Exit cleanly.

Confirm gh is authenticated against this repo's remote:
```bash
gh repo view --json owner,name >/dev/null \
  || { echo "Not in a GitHub repo (or gh not authenticated). Aborting."; exit 1; }
```

### Reconcile stale cleanup

burndown-implement archives clarifications and removes the worktree right after writing
`phase: "done"`. That trailing step can be skipped if a run is interrupted at the
implement→ship seam, leaving a done issue's answered clarifications stranded in the active
dir and its worktree on disk. Re-assert it here — idempotent, runs every ship, so any
straggler self-heals on the next invocation. Same two operations implement already does:

```bash
mkdir -p "$MAIN_REPO/.oddkit/burndown-archive-clarifying-questions"
for f in $(grep -lE '"phase"[[:space:]]*:[[:space:]]*"done"' "$TRACKING_DIR"/*.json 2>/dev/null); do
  n=$(basename "$f" .json)
  q="$MAIN_REPO/.oddkit/burndown-clarifying-questions/$n.md"
  [ -f "$q" ] && mv -f "$q" "$MAIN_REPO/.oddkit/burndown-archive-clarifying-questions/$n.md"
  git -C "$MAIN_REPO" worktree remove --force ".oddkit/worktrees/burndown-issue-$n" 2>/dev/null
done
```

## Phase 1 — Decide: fresh, resume-mid-classify, or resume-mid-ship

Three mutually exclusive cases — check in this order:

**A. Resume mid-classify.** `$PENDING_FILE` exists. This means a prior run returned from
`burndown-implement` but crashed before writing `ship.phase` on the new PRs.
→ Skip Phase 2. Re-invoke burndown-implement once for idempotent recovery (Phase 2's
inner step still runs — see below), then continue to Phase 3 using the persisted
`pre_terminal` from the file.

**B. Resume mid-ship.** No pending file, but at least one tracking file has a
non-terminal `ship.phase`. → Proceed to Phase 2 with an **expanded `pre_terminal`** (see
Phase 2). Do NOT skip burndown-implement. The developer may have answered clarifying
questions or pushed new-ready issues since the last invocation; skipping implement would
silently strand those issues forever. The expanded `pre_terminal` ensures Phase 3 only
classifies genuinely new PRs and doesn't re-touch issues already in the ship pipeline.

**C. Fresh.** No pending file, no non-terminal `ship.phase` anywhere. → Proceed to
Phase 2.

Cases B and C both go through Phase 2 — the only difference is how `pre_terminal` is
built (see Phase 2).

"Non-terminal" means `ship.phase` is set and is not one of `vetted_clean`, `shipped`,
`ship_failed`, `ship_not_eligible`.

## Phase 2 — Snapshot, then run burndown-implement

(Cases B and C — always runs.)

Scan `$TRACKING_DIR/*.json`. Build `pre_terminal`: the list of issue numbers to exclude
from Phase 3 classification. What goes in differs by case:

- **Case C (fresh):** issue numbers where `phase ∈ {done, failed, blocked, already_done}`.
  These were finalized by burndown-implement before this run; they're old work.
- **Case B (resume mid-ship):** same as Case C, **plus** any issue that already has a
  `ship.phase` set (any value, terminal or not). These are already in the ship pipeline
  and must not be re-classified by Phase 3.

Write `$PENDING_FILE` atomically (`mv tmp final`):

```json
{
  "run_ts": "<RUN_TS>",
  "pre_terminal": [12, 34, 56]
}
```

Invoke `/oddkit:burndown-implement --yolo` via the Skill tool:

```
Skill(skill: "oddkit:burndown-implement", args: "--yolo")
```

Follow burndown-implement's instructions to completion. It may take a long time —
that's fine, it manages its own parallelism. The Skill tool just loads its
instructions into this same conversation; when you finish executing them you continue
straight into the next section below.

**CRITICAL — the mental model trap.** When burndown-implement prints its
`## burndown-implement done` report, your instinct will be to think "the sub-skill
finished, now control returns to the orchestrator." That instinct is wrong. There is
no other orchestrator. You ARE burndown-ship; burndown-implement is a script you were
following inside the same conversation. The report is just text you wrote. Your next
tool call should be Phase 3's classification logic — NOT ending the turn.

Mark Phase 2's task done and immediately proceed to Phase 3 — unless one of the
explicit exit conditions below applies.

If burndown-implement reports zero issues touched:
- **Case C:** the run set is empty. Delete `$PENDING_FILE` and print "Nothing to ship —
  no issues were ready for `/oddkit:burndown-implement`." Exit.
- **Case B:** there are still in-progress ship issues from the previous invocation.
  Delete `$PENDING_FILE` and jump directly to Phase 4 — don't exit.

Otherwise (at least one issue was touched): proceed to Phase 3 immediately.

Your next action after burndown-implement completes is a Bash call running the
classification logic in Phase 3. Do not stop, do not summarize, do not say
"handing off." Just start Phase 3.

## Phase 3 — Classify newly-created PRs

Read `pre_terminal` from `$PENDING_FILE`.

Scan `$TRACKING_DIR/*.json` again. For each tracking file, decide based on the issue
number and its current `phase`:

| Was in pre_terminal? | Current phase                  | Action                                                          |
|----------------------|--------------------------------|-----------------------------------------------------------------|
| Yes                  | (any)                          | Leave alone — old work, not from this run                       |
| No                   | `done` + `pr_url` set          | Set `ship.phase = "needs_vet"`, `ship.started_at = <RUN_TS>`    |
| No                   | `failed` / `blocked`           | Set `ship.phase = "ship_not_eligible"`, `ship.failure_reason = "burndown-implement: <phase>"` |
| No                   | `already_done`                 | Set `ship.phase = "ship_not_eligible"`, `ship.failure_reason = "burndown-implement: already_done (no PR to ship)"` |
| No                   | non-terminal (pending/etc.)    | Leave alone — burndown-implement skipped it (unanswered, etc.)  |

Writes use the standard read-modify-write pattern. Read the JSON, add/update the `ship`
sub-object, write atomically (`tmp` + `mv`). Preserve all other fields verbatim.

### Sync each opened PR (project-local skill)

Each issue that transitions to `ship.phase = "needs_vet"` here had its PR opened by this
run — that's the "a PR was just opened" moment. If this project ships its own
`sync-issues` skill, sync that one issue as the transition is written. Detect it once
(reuse the result across all transitions this run):
```bash
test -f "$MAIN_REPO/.claude/skills/sync-issues/SKILL.md" && echo exists
```

For each newly-`needs_vet` issue, invoke the skill by its bare name with **just that
issue's number**:
```
Skill(skill: "sync-issues", args: "<issue_number>")
```
Fires exactly once per newly-opened PR: resumes exclude already-classified issues via
`pre_terminal`, so a re-run won't re-sync. Best-effort — if the skill is absent, skip
silently; if it errors, `log()` it and keep classifying. A sync failure never changes the
issue's `ship.phase` or blocks vetting.

After every newly-done issue has `ship.phase` set, delete `$PENDING_FILE`:

```bash
rm -f "$PENDING_FILE"
```

If no issues ended up with `ship.phase = "needs_vet"`, the pipeline has nothing to vet.
Skip ahead to Phase 7 and print the summary (which will only contain ship_not_eligible
entries plus a "no PRs created" headline).

## Phase 4 — Vet new PRs

Build the **vet set**: every issue with `ship.phase == "needs_vet"`. Skip this phase if
empty.

Extract `(issue_number, pr_number)` pairs by parsing `pr_url` from each tracking file
(e.g. `https://github.com/owner/repo/pull/45` → `pr_number = 45`). Store this mapping
locally — you'll need it through Phase 6.

Invoke vet-prs with the explicit PR list:

```
Skill(skill: "oddkit:vet-prs", args: "<pr1> <pr2> ... --yolo")
```

Where `<pr1> <pr2> ...` are bare PR numbers separated by spaces. The `--yolo` flag
skips all interactive prompts in vet-prs (including its "already vetted" check).

When vet-prs returns, for each PR in the vet set, read its result at
`$MAIN_REPO/.oddkit/vet-prs/<pr_number>.json`:

```json
{
  "scope": "S|M|L",
  "intent": "✓|⚠️|✗",
  "smell": "clean|iffy|red",
  ...
}
```

If the file is missing (vet-prs hit a parse error and skipped writing it), record
`ship.phase = "ship_failed"`, `ship.failure_reason = "vet-prs: no verdict written"`,
and move on. Other PRs are unaffected.

Otherwise, decide the route per the rules below, write the route to the tracking file,
and transition `ship.phase`.

### Routing rules

```
needs_action = (smell != "clean") OR (intent != "✓")

if not needs_action:
    ship.vet_route = "done"
    ship.phase     = "vetted_clean"     # terminal
elif smell == "red" or scope == "L":
    ship.vet_route = "review"
    ship.phase     = "needs_deep_review"
else:
    # smell == "iffy" OR intent ∈ {"⚠️","✗"}, and scope ∈ {S, M}
    ship.vet_route = "feedback"
    ship.phase     = "needs_address_feedback"
```

Plain-English: a PR that comes back clean *and* matches its stated intent is done.
Anything else needs action. Red smell or any large/risky change gets a deep review
first; smaller suspicious PRs go straight to address-feedback.

Also write `ship.vet_verdict = {scope, intent, smell}` so the summary can quote it
later without re-reading vet-prs state.

## Phase 5 — Deep review (serially, per PR)

Build the **review set**: every issue with `ship.phase == "needs_deep_review"`. Skip
this phase if empty.

Process one PR at a time. `oddkit:review` posts to GitHub and writes commits; running
them in parallel risks rate limits and is hard to recover from on failure.

For each PR in the review set, in order, invoke the `oddkit:review` skill by its full
namespaced name (not a bare `review`, which may resolve to a different skill):

```
Skill(skill: "oddkit:review", args: "#<pr_number> --yolo")
```

When it returns:
- **Success** (review posted): write `ship.phase = "needs_address_feedback"`,
  `ship.review_done_at = <now utc>`. Move on.
- **Failure** (skill errored, or posting failed): write `ship.phase = "ship_failed"`,
  `ship.failure_reason = "review: <one-line reason>"`. Move on. Other PRs continue.

Write tracking immediately after each return — resumability depends on it.

## Phase 6 — Address feedback (serially, per PR)

Build the **feedback set**: every issue with `ship.phase == "needs_address_feedback"`.
This includes both PRs routed straight from vet (iffy/wrong-intent at S/M) and PRs that
just finished Phase 5's deep review. Skip this phase if empty.

Process one PR at a time. For each PR in the feedback set, in order:

```
Skill(skill: "oddkit:address-feedback", args: "#<pr_number> --yolo")
```

When it returns:
- **Success**: write `ship.phase = "shipped"` (terminal),
  `ship.feedback_done_at = <now utc>`. Move on.
- **Failure**: write `ship.phase = "ship_failed"`,
  `ship.failure_reason = "address-feedback: <one-line reason>"`. Move on.

Detect failure conservatively: the address-feedback skill exits cleanly even when
nothing actionable was found (zero unresolved comments). That's a success, not a
failure — there was simply no feedback to address. Only flag failure when the skill
clearly errored (push rejected, comment-post failed, exception thrown).

## Phase 7 — Summary

Scan all tracking files. For each issue that has a `ship` sub-object (regardless of
phase), group by `ship.phase` and print:

```
## Burndown ship complete — <YYYY-MM-DD HH:mm UTC>

### Shipped clean ({A})
- #123 (PR <pr_url>) — vet: S/✓/clean. No action needed.

### Shipped after feedback ({B})
- #124 (PR <pr_url>) — vet: M/✓/iffy → address-feedback. Done.

### Shipped after review + feedback ({C})
- #125 (PR <pr_url>) — vet: L/⚠️/iffy → review + address-feedback. Done.
- #126 (PR <pr_url>) — vet: M/✓/red → review + address-feedback. Done.

### Failed during ship ({D})
- #127 (PR <pr_url>) — review: <reason>. Manual recovery needed.

### Not eligible ({E})
- #128 — burndown-implement: failed. See tracking file for details.
- #129 — burndown-implement: blocked (predecessor #127 failed).
- #130 — burndown-implement: already_done (no PR to ship).

### Next steps
- Failed-during-ship issues: inspect the PR, then either clear `ship.phase` in the
  tracking file (and re-run /oddkit:burndown-ship) or finish the work by hand.
- Not-eligible issues: check `.oddkit/burndown-issue-tracking/<n>.json`'s `phase` and
  `failure_reason`. Re-plan or retry per the burndown-implement skip rules.
```

Omit any section that has zero entries — keep the report dense. If everything ended in
`vetted_clean` or `shipped`, lead with one celebratory sentence and only print the
breakdown.

## Resume semantics

Re-running `/oddkit:burndown-ship` is always safe. The skill checks:

1. **Pending file exists** → resume mid-classify (Case A). Re-invokes burndown-implement
   once for idempotent recovery, then classifies using the persisted `pre_terminal`.
2. **Non-terminal `ship.phase` somewhere** → resume mid-ship (Case B). Runs
   burndown-implement with an expanded `pre_terminal` (issues already in the ship
   pipeline are excluded from re-classification). Any issues the developer has since
   answered or unblocked get picked up. Then continues Phase 4+ for all non-terminal
   ship issues.
3. **Neither** → fresh run (Case C). Runs burndown-implement from scratch.

Manual recovery:
- To **retry a `ship_failed` issue**: set its `ship.phase` to the step you want to resume
  from (`needs_address_feedback` or `needs_deep_review`) and re-run. Note that any
  half-completed work — e.g. a posted review — stays on the PR; if you resume from
  `needs_deep_review` after the review already posted, you'll get a second one. Prefer
  resuming from `needs_address_feedback` unless the review never landed.
- To **force a re-vet of a particular PR**: set its `ship.phase = "needs_vet"` and
  delete `$MAIN_REPO/.oddkit/vet-prs/<pr_number>.json`. Re-run.
- To **force-stop the pipeline for one issue**: set `ship.phase = "ship_failed"` with a
  manual `ship.failure_reason`. The skill won't touch it again.

## Failure isolation

Each PR's ship pipeline is independent. A failure during review or address-feedback on
PR #123 doesn't pause or affect PR #124. Failures are recorded inline (per-tracking-
file `ship.failure_reason`) and surfaced in the summary, never thrown as orchestrator
errors.

The only orchestrator-level failure is in Phase 0 / Phase 2 (bad working tree, gh not
authenticated, or burndown-implement errored before producing any state). In those
cases, exit with a clear message and don't try to "make progress" anyway.

## Notes for the implementer

- **The most common failure mode is stopping after burndown-implement returns.** The
  trap is mental, not behavioral: you read the `## burndown-implement done` report and
  think a sub-skill just returned control to some external orchestrator. That
  orchestrator does not exist. burndown-implement's instructions ran inside this same
  conversation — you wrote that report. Phases 3–7 (classify, vet, review, feedback,
  summary) are still ahead of you, and "you" means the same Claude that just finished
  Phase 2. Do not end the turn there.
- **All sub-skill invocations go through the Skill tool**, not through Bash or Agent.
  This keeps the user's experience consistent — slash commands and Skill invocations
  funnel through the same loaders.
- **Always pass `--yolo`** on every sub-skill invocation. Without it, sub-skills will
  pause for confirmation and break autonomy. The other skills have been updated so
  `--yolo` means "fully non-interactive" across the board.
- **Write `ship.*` updates atomically.** Read the tracking JSON, mutate the `ship`
  sub-object only, write to `<n>.json.tmp`, then `mv` over the existing file. Preserve
  every other field (the impl agents and burndown-implement own `phase`, `pr_url`,
  etc. — don't touch them).
- **Don't introduce new top-level folders.** No `.oddkit/burndown-ship/` directory.
  The only new file is the transient `burndown-ship-pending.json` directly under
  `.oddkit/`, and it's deleted as soon as Phase 3 finishes.
- **Sub-skills already handle their own worktrees.** Don't create worktrees here.
- **Don't run vet/review/address-feedback on PRs not produced by this run.** The
  `pre_terminal` snapshot is what enforces this — never widen the vet set beyond
  `ship.phase == "needs_vet"` issues.
- **Serial, not parallel** for Phase 5 and Phase 6. Each invokes a long-running skill
  that writes commits and posts to GitHub. Parallelism would race on the local repo
  state (each skill makes its own worktree, but pushes share branches with the remote)
  and make failure recovery harder.
