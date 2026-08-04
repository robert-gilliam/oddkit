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
get a `ship` field, vet-prs writes to its own `.oddkit/vet-prs/`. Per-issue code worktrees
go under `.claude/worktrees/` (so the impl agent can enter them to edit without the
permission-root relocation prompt); durable state stays in `.oddkit/`. The one transient
file is deleted as soon as classification is done.

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
| `needs_address_feedback`    | vet flagged iffy/⚠️/✗ at S/M scope                                  | Phase 6 — address-feedback                   |
| `needs_deep_review`         | vet flagged red, or iffy/⚠️/✗ at L scope                            | Phase 5 — review, then address-feedback      |
| `needs_ci`                  | Routing actions complete; CI verdict not yet confirmed             | Phase 7 — CI gate                            |
| `vetted_clean` *(terminal)* | vet returned smell=clean + intent=✓, CI green                      | Done                                         |
| `shipped` *(terminal)*      | All routing actions complete, CI green                             | Done                                         |
| `ship_failed` *(terminal)*  | A sub-skill or CI failed for this PR; other PRs not affected       | Surface in summary; manual recovery          |
| `ship_not_eligible` *(terminal)* | burndown-implement didn't produce a PR (failed/blocked/skipped) | Surface in summary; manual recovery          |

Companion fields on the `ship` object:
- `started_at` (iso utc) — when this issue entered the ship pipeline
- `vet_verdict` (`{scope, intent, smell}`) — written in Phase 4
- `vet_route` (`"done" | "feedback" | "review"`) — the routing decision in Phase 4
- `review_done_at` (iso utc) — set when Phase 5 completes for this PR
- `feedback_done_at` (iso utc) — set when Phase 6 completes for this PR
- `ci_status` (`"pass" | "fail" | "none" | "pending"`) — written in Phase 7
- `failure_reason` (string) — set if `ship.phase == "ship_failed"`
- `reason` (string) — set if `ship.phase == "ship_not_eligible"` (why no PR existed;
  not a failure field — `already_done` lands here too)

## Startup checklist

**Before touching any files or running any commands**, create a task for each phase so
you track remaining work and don't stop early:

```
TaskCreate: "burndown-ship Phase 2 — run burndown-implement"
TaskCreate: "burndown-ship Phase 3 — classify new PRs"
TaskCreate: "burndown-ship Phase 4 — vet PRs"
TaskCreate: "burndown-ship Phase 5 — deep review"
TaskCreate: "burndown-ship Phase 6 — address feedback"
TaskCreate: "burndown-ship Phase 7 — CI gate"
TaskCreate: "burndown-ship Phase 8 — print summary"
```

Mark each task done only when that phase actually completes. **burndown-implement's
`## burndown-implement done` report is NOT your completion signal — it's just a line
of text you wrote inside the same conversation. You ARE burndown-ship, and you must
complete every phase through Phase 8 before this skill is done.**

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
  git -C "$MAIN_REPO" worktree remove --force ".claude/worktrees/burndown-issue-$n" 2>/dev/null
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
| No                   | `failed` / `blocked`           | Set `ship.phase = "ship_not_eligible"`, `ship.reason = "burndown-implement: <phase>"` |
| No                   | `already_done`                 | Set `ship.phase = "ship_not_eligible"`, `ship.reason = "burndown-implement: already_done (no PR to ship)"` |
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
Skip ahead to Phase 8 and print the summary (which will only contain ship_not_eligible
entries plus a "no PRs created" headline).

## Phase 4 — Vet new PRs

Build the **vet set**: every issue with `ship.phase == "needs_vet"`. Skip this phase if
empty.

Extract `(issue_number, pr_number)` pairs by parsing `pr_url` from each tracking file
(e.g. `https://github.com/owner/repo/pull/45` → `pr_number = 45`). Store this mapping
locally — you'll need it through Phase 7.

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
    ship.phase     = "needs_ci"         # terminal only after CI confirms (Phase 7)
elif smell == "red" or scope == "L":
    ship.vet_route = "review"
    ship.phase     = "needs_deep_review"
else:
    # smell == "iffy" OR intent ∈ {"⚠️","✗"}, and scope ∈ {S, M}
    ship.vet_route = "feedback"
    ship.phase     = "needs_address_feedback"
```

Plain-English: a PR that comes back clean *and* matches its stated intent goes straight
to the CI gate. Anything else needs action first. Red smell or any large/risky change
gets a deep review; smaller suspicious PRs go straight to address-feedback.

The feedback route has a load-bearing dependency: vet-prs posts its Concerns as a PR
comment, and that comment is what address-feedback ingests in Phase 6. If vet's comment
failed to post for a PR routed `"feedback"`, note it now — Phase 6 uses this to tell a
legitimate "nothing to address" apart from "the concerns never landed."

Also write `ship.vet_verdict = {scope, intent, smell}` so the summary can quote it
later without re-reading vet-prs state.

## Phase 5 — Deep review (serially, per PR)

Build the **review set**: every issue with `ship.phase == "needs_deep_review"`. Skip
this phase if empty.

Process one PR at a time, **chain heads first**: if any issue in the set appears in
another tracking file's `blocked_by`, it's a predecessor in a stacked chain — handle it
before its dependents so fixes land upstream before downstream PRs get touched.
`oddkit:review` posts to GitHub and writes commits; running them in parallel risks rate
limits and is hard to recover from on failure.

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

Process one PR at a time, **chain heads first** (same ordering rule as Phase 5: an issue
listed in another tracking file's `blocked_by` is a predecessor — do it before its
dependents). For each PR in the feedback set, in order:

```
Skill(skill: "oddkit:address-feedback", args: "#<pr_number> --yolo")
```

When it returns:
- **Success**: write `ship.phase = "needs_ci"`,
  `ship.feedback_done_at = <now utc>`. Move on.
- **Failure**: write `ship.phase = "ship_failed"`,
  `ship.failure_reason = "address-feedback: <one-line reason>"`. Move on.

Detect failure conservatively — with one exception. The address-feedback skill exits
cleanly even when nothing actionable was found (zero unresolved comments). Whether
that's a success depends on how the PR got here:
- **`vet_route == "review"`**: zero actionable comments is legitimate — Phase 5's review
  may have found nothing worth an inline comment. Success.
- **`vet_route == "feedback"`**: the vet concerns comment was the entire reason for this
  route. Zero actionable comments means those concerns never reached the PR (comment
  failed to post, or was filtered out). Write `ship.phase = "ship_failed"`,
  `ship.failure_reason = "feedback route: vet concerns never landed on the PR"` — don't
  mark a PR shipped when the thing it was flagged for was never looked at.

Otherwise only flag failure when the skill clearly errored (push rejected, comment-post
failed, exception thrown).

**Stale chain dependents.** If address-feedback pushed commits to a PR that other issues
stack on (its issue number appears in their `blocked_by`), those dependent PRs now have a
stale base. Don't rebase them automatically — record the dependents locally and surface
them in Phase 8's summary as needing a manual rebase.

## Phase 7 — CI gate

Build the **CI set**: every issue with `ship.phase == "needs_ci"`. Skip this phase if
empty.

Local checks at implement time are a proxy; CI green is the actual bar for
"merge-ready." Nothing goes terminal-happy without it. For each PR in the CI set, wait
for its checks with two separate Bash calls — the first waits, the second takes the
snapshot the verdict is read from. Separate calls mean the timebox killing the watch
can't eat the snapshot, and the refreshing `--watch` table never streams into your
context:

```bash
gh pr checks <pr_number> --watch > /dev/null 2>&1   # call 1: wait (timebox ~10 min via the Bash tool timeout)
gh pr checks <pr_number>                            # call 2: one snapshot for the verdict
```

Determine pass/fail/pending/none from call 2's snapshot output, not the exit code
alone — `gh pr checks` exits 1 for both "a check failed" and "no checks configured"
(pass = 0, pending = 8). If call 1 hit the timebox, the snapshot still shows current
state for the `pending` branch.

Read the outcome from the snapshot:
- **All checks pass** → `ship.ci_status = "pass"`. Transition by route:
  `vet_route == "done"` → `ship.phase = "vetted_clean"`; anything else →
  `ship.phase = "shipped"`. Both terminal.
- **No checks reported** (repo has no CI configured for this base) →
  `ship.ci_status = "none"`. Same transitions as pass — there's nothing to gate on.
  Note it in the summary line so "green" isn't overstated.
- **Any check fails** → `ship.ci_status = "fail"`, `ship.phase = "ship_failed"`,
  `ship.failure_reason = "ci: <failing check name(s)>"`. Move on; other PRs are
  unaffected.
- **Still pending at the timebox** → `ship.ci_status = "pending"` and leave
  `ship.phase = "needs_ci"`. Don't guess. The summary lists it, and a later re-run of
  `/oddkit:burndown-ship` re-checks it (resume Case B picks up `needs_ci` as
  non-terminal).

Write tracking after each PR's verdict — don't batch.

## Phase 8 — Summary

Scan all tracking files. For each issue that has a `ship` sub-object (regardless of
phase), group by `ship.phase`. Also scan for issues with **no** `ship` sub-object whose
`phase` is `implementing` — those are stuck mid-implementation from an interrupted run,
invisible to every `--yolo` re-run until a human intervenes, and this summary is the
only place the walk-away developer will hear about them. Print:

```
## Burndown ship complete — <YYYY-MM-DD HH:mm UTC>

### Shipped clean ({A})
- #123 (PR <pr_url>) — vet: S/✓/clean, CI: pass. No action needed.

### Shipped after feedback ({B})
- #124 (PR <pr_url>) — vet: M/✓/iffy → address-feedback, CI: pass. Done.

### Shipped after review + feedback ({C})
- #125 (PR <pr_url>) — vet: L/⚠️/iffy → review + address-feedback, CI: pass. Done.
- #126 (PR <pr_url>) — vet: M/✓/red → review + address-feedback, CI: none (no CI configured). Done.

### Awaiting CI ({F})
- #131 (PR <pr_url>) — checks still running at timeout. Re-run /oddkit:burndown-ship to
  re-check, or watch: gh pr checks <n> --watch

### Failed during ship ({D})
- #127 (PR <pr_url>) — review: <reason>. Manual recovery needed.
- #132 (PR <pr_url>) — ci: lint failing. Manual recovery needed.

### Chain rebase needed ({G})
- #456 (PR <pr_url>) — base PR #123 got new commits during address-feedback. Rebase the
  branch on the updated base before merging.

### Stuck in progress ({H})
- #321 — phase: implementing since <updated_at>, no ship state. A previous run was
  interrupted mid-implementation; --yolo never re-spawns these. To recover: confirm no
  agent is still running, then set phase to "ready" in
  .oddkit/burndown-issue-tracking/321.json and re-run.

### Not eligible ({E})
- #128 — burndown-implement: failed. See tracking file for details.
- #129 — burndown-implement: blocked (predecessor #127 failed).
- #130 — burndown-implement: already_done (no PR to ship).

### Next steps
- Failed-during-ship issues: inspect the PR, then either clear `ship.phase` in the
  tracking file (and re-run /oddkit:burndown-ship) or finish the work by hand.
- Not-eligible issues: check `.oddkit/burndown-issue-tracking/<n>.json`'s `phase` and
  `ship.reason`. Re-plan or retry per the burndown-implement skip rules.
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
   ship issues — including `needs_ci` issues whose checks were still pending last run.
3. **Neither** → fresh run (Case C). Runs burndown-implement from scratch.

Manual recovery:
- To **retry a `ship_failed` issue**: set its `ship.phase` to the step you want to resume
  from (`needs_address_feedback`, `needs_deep_review`, or `needs_ci` for a CI failure
  you've since fixed by hand) and re-run. Note that any
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
  conversation — you wrote that report. Phases 3–8 (classify, vet, review, feedback,
  CI gate, summary) are still ahead of you, and "you" means the same Claude that just
  finished Phase 2. Do not end the turn there.
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
