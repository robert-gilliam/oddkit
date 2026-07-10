---
name: one-shot
description: >
  Take a single task from a bare description to a merge-ready (or merged) PR in one
  autonomous run: optionally open an issue, recon the codebase, plan, implement with TDD,
  open a PR, optionally review-and-fix, drive CI to green, and — with --yolo — merge. Asks
  the developer nothing except in a genuine emergency (a change that would cause breaking
  regressions and spiral into a rabbit hole, demand an XL refactor, or run against the
  app's intent). Invoke with flags (--create-issue, --with-review, --yolo) or a plain
  verbal description like "one-shot a fix for the flaky retry logic and merge it". Use when
  the developer wants one command to carry a task end-to-end hands-off — "one-shot this",
  "take this all the way to a PR", "build and ship X", "just do it and merge", or
  "/oddkit:one-shot". Pick this for a single task; pick /oddkit:burndown-ship for a batch
  of pre-planned issues.
argument-hint: "[task description] [--create-issue] [--with-review] [--yolo]"
model: opus
---

# One-Shot

Carry one task the whole way — issue (optional) → recon → plan → implement (TDD) → PR →
review-and-fix (optional) → CI green → merge (optional) — in a single autonomous run. This
is the single-task sibling of `/oddkit:burndown-ship`: same routing philosophy, no batch,
no offline clarifying questions.

**The autonomy contract.** You never ask the developer a question. Every ambiguity is a
decision you make from the code, the task, and sensible defaults — you pick the most
reasonable option and note it in the PR body. The one exception is a genuine **emergency**
(defined below), where stopping to ask is the right call precisely because plowing ahead
would do damage. Emergencies are rare. If you catch yourself wanting to ask something that
isn't one, answer it yourself and keep going.

**Reuse over reinvention.** This skill sequences existing, verified pieces: the
`@oddkit:code-scout` / `@oddkit:impact-scout` recon agents, the TDD/verify/PR discipline in
`references/implement-agent.md`, and the `oddkit:review-and-fix` skill. It adds only the
glue: intent parsing, the emergency brake, the CI-green loop, and the merge gate.

**Invoke sub-skills by their full `oddkit:` name.** Pass the exact string
`oddkit:review-and-fix` to the `Skill` tool. Other installed skills may share a word like
"review," so copy the namespaced name from the phase, don't select by concept. Project-local
skills (`create-issue`, `sync-issues`) are invoked by their bare name.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

## You are the orchestrator — there is no other Claude

Sub-skills load into THIS conversation via the `Skill` tool — they don't spawn a separate
process. When `review-and-fix` finishes, you are still one-shot, and the next phase (CI
gate) is yours to run. There is no "handoff back." Don't end the turn after a sub-skill
returns; continue to the next phase.

## Parse arguments and infer intent

Read `$ARGUMENTS`. Separate the **task description** (the free text) from the **flags**.
Then resolve three switches — each is on if its flag is present *or* the description implies
it:

| Switch          | Flag             | Verbal signals (examples)                                         | Default |
|-----------------|------------------|-------------------------------------------------------------------|---------|
| `CREATE_ISSUE`  | `--create-issue` | "open/file/create an issue for…", "track this as an issue first"   | off     |
| `WITH_REVIEW`   | `--with-review`  | "review it", "make it solid", "vet the change", "review and fix"   | off     |
| `MERGE`         | `--yolo`         | "merge it", "ship it", "all the way", "yolo", "take it to merge"   | off     |

The defaults are deliberately safe: with no signal, one-shot opens a PR and drives CI green
but does **not** create an issue or merge. Those are the only irreversible-ish actions, so
they stay opt-in — this keeps "no questions" safe rather than reckless.

If the description also references an existing issue (`#N` or an issue URL) and `CREATE_ISSUE`
is off, treat that issue as the spec (Phase 1).

If there is **no** task description at all (no free text, no issue ref), you have nothing to
act on — this is missing input, not an emergency. Ask once: "What should I one-shot? Give me
a task, an issue number, or a URL." Then proceed.

Echo the resolved plan in one line before starting, e.g.:
`One-shot: <task> — create-issue: no · review: yes · merge (yolo): yes · base: main`.

## Phase 0 — Preflight

```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
git -C "$MAIN_REPO" fetch origin --prune
gh repo view --json owner,name >/dev/null \
  || { echo "Not in a GitHub repo (or gh not authenticated). Aborting."; exit 1; }
```

Resolve the base branch (the PR target and recon point):

```bash
BASE_BRANCH=$(git -C "$MAIN_REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||')
# Fallback to main, then master. Verify it exists:
git -C "$MAIN_REPO" rev-parse --verify "origin/$BASE_BRANCH" >/dev/null 2>&1 \
  || { echo "Base branch not found on origin. Aborting."; exit 1; }
```

Create the startup task list so you don't stop early — one task per phase you'll actually
run (skip Phase 1 if `CREATE_ISSUE` is off, Phase 4 if `WITH_REVIEW` is off, Phase 6 if
`MERGE` is off).

## Phase 1 — Establish the spec

The spec (`ISSUE_SPEC`) is the authoritative statement of what "done" means. It drives the
plan, the implementation, and the completeness check in review-and-fix.

**If `CREATE_ISSUE` is on:**

1. Run a quick recon pass so the issue cites real paths (spawn `@oddkit:code-scout` with a
   tight prompt, or reuse Phase 2's recon if you'd rather do it once — either order is fine).
2. Detect a project-local create-issue skill:
   ```bash
   test -f "$MAIN_REPO/.claude/skills/create-issue/SKILL.md" && echo exists
   ```
   - **Exists** → invoke it and let it own issue shape and conventions:
     `Skill(skill: "create-issue", args: "<task description>")`. Capture the created issue
     number and URL from its output.
   - **Absent** → create the issue yourself with `gh issue create`, using the lightweight
     spec template in `references/issue-template.md` (Problem / Acceptance criteria / Files
     likely touched). Keep it a spec, not a design doc.
3. Store `ISSUE_NUMBER`, `ISSUE_URL`. `ISSUE_SPEC` = the issue body.

**If an existing issue is referenced** (`#N` / URL), `CREATE_ISSUE` off:
`gh issue view <N> --json number,title,body,url` → `ISSUE_SPEC` = title + body; store
`ISSUE_NUMBER`, `ISSUE_URL`.

**Otherwise** (pure verbal task, no issue): `ISSUE_SPEC` = the task description itself.
`ISSUE_NUMBER` is unset — the PR won't have a `Closes #N`.

## Phase 2 — Recon, classify, plan

Set up a read-only recon worktree pinned to fresh base state:

```bash
RECON_WT="$MAIN_REPO/.oddkit/worktrees/one-shot-recon"
git -C "$MAIN_REPO" worktree add --detach "$RECON_WT" "origin/$BASE_BRANCH"
```

(If the path exists, append `-2`, `-3`.) Spawn `@oddkit:code-scout` and `@oddkit:impact-scout`
(**`model: sonnet`**) in one message. Pass `RECON_WT` as `cwd` and the `ISSUE_SPEC`. code-scout
finds where the work lands and the pattern to follow; impact-scout traces blast radius,
integration points, and recent churn.

**Classify** from the recon:
- **simple** — one or two files, clear behavior, recon gives a direct template.
- **complex** — multi-file, branching design, ambiguous logic, or wide blast radius. Gets a
  written plan before implementation.

### Emergency check #1 — blast radius

This is the natural checkpoint for the emergency brake (see **Emergency protocol**). Before
committing to implementation, weigh what recon revealed. Stop and ask **only** if the honest
assessment is one of:
- **Rabbit hole / breaking regressions** — the change can't be made without breaking
  existing behavior across unrelated callers, and containing the fallout balloons the work.
- **XL refactor** — delivering the task correctly requires restructuring a subsystem,
  changing widely-depended-on interfaces, or a migration — far beyond the task as stated.
- **Against the app's intent** — the task, implemented faithfully, would work against what
  the application is clearly built to do.

If none apply (the common case), proceed — a merely large or multi-file change is *not* an
emergency; that's just the work.

### Plan (complex only)

For a complex task, spawn a plan-generation Agent (**`model: opus`** — the plan drives
everything downstream). Give it the `ISSUE_SPEC` and the full recon output; have it return a
concrete plan (overview, key decisions, risks, phased steps with file paths and how to
verify each). Hold the returned plan text — you'll pass it to the implementer. Simple tasks
skip planning and are implemented from spec + recon directly.

Remove the recon worktree once recon and planning are done:

```bash
git -C "$MAIN_REPO" worktree remove --force "$RECON_WT"
```

## Phase 3 — Implement (TDD) and open the PR

Spawn **one** implementation Agent using the handoff in `references/implement-agent.md`.
**Model:** `opus` for complex, `sonnet` for simple. Pass `mode: "bypassPermissions"` — this
is the unattended phase. Substitute into the handoff: the `ISSUE_SPEC`, the recon output, the
plan (complex only), `BASE_BRANCH`, and `ISSUE_NUMBER` (for `Closes #N`, or "none").

The agent owns its own code worktree, works test-first, verifies locally against everything
CI will run, commits per cycle, pushes, and opens the PR. It returns a structured result.

Parse the return:
- **`STATUS: done`** → store `PR_URL`, `PR_NUMBER` (parse from the URL), `HEAD_BRANCH`,
  `TESTS`, `WORKTREE`, `SUMMARY`, `CAVEATS`. Continue.
- **`STATUS: emergency`** → the implementer hit a rabbit hole / XL-refactor / against-intent
  wall it couldn't contain. Do **not** thrash. Run the **Emergency protocol** with its
  reason. (Its worktree and any local commits stay for inspection.)
- **`STATUS: failed`** → implementation genuinely couldn't land (not an emergency, e.g. a
  test that won't pass, a missing credential). Skip to Phase 8 and report the failure with
  the worktree path; leave no PR, or an open PR if one was made before the failure.

## Phase 4 — Review and fix (if `WITH_REVIEW`)

Only if `WITH_REVIEW` is on and a PR exists. Hand the PR to the verified review+fix loop:

```
Skill(skill: "oddkit:review-and-fix", args: "#<PR_NUMBER> --yolo")
```

It reviews against the source issue, fixes every real finding in-place, loops until clean,
runs the project's tests, and posts a review trail on the PR. When it returns, you are still
one-shot — continue to Phase 5. If it reports it couldn't finish a piece (a last-resort
follow-up), carry that note into the final summary; it does not block the CI gate.

## Phase 5 — Drive CI to green

CI green is the real bar for merge-ready — local checks are only a proxy. Skip only if no PR
exists.

Watch the checks (timebox each `--watch` via the Bash tool timeout, ~10 min):

```bash
gh pr checks <PR_NUMBER> --watch
```

- **All pass** → record CI green. Continue.
- **No checks configured** → nothing to gate on. Note it in the summary so "green" isn't
  overstated. Continue.
- **Any check fails** → fix it, don't just report it. Read the failing logs
  (`gh run view <run-id> --log-failed`), then spawn one fix Agent (`model: sonnet`,
  `mode: "bypassPermissions"`) on a worktree of `HEAD_BRANCH`: give it the failing check name
  and log excerpt, have it reproduce locally, fix the root cause, re-run the failing command,
  commit, and push. Re-watch. **Cap at 3 rounds.** If still red after 3, stop fixing: leave
  the PR open, set the verdict to "CI red — needs human eyes," and report the failing checks
  in Phase 8. A persistently red pipeline after honest attempts is a reporting outcome, not
  an emergency (nothing is being damaged) — unless a fix would require an XL refactor or
  breaks unrelated behavior, in which case run the **Emergency protocol**.
- **Still pending at the timebox** → don't guess. Note "CI still running" in the summary and
  do not merge.

## Phase 6 — Merge (if `MERGE`)

Only if `MERGE` is on, CI is green (or genuinely no checks configured), and — when
`WITH_REVIEW` ran — review-and-fix finished clean. Merge into the base:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

Use the repo's prevailing merge style if it clearly differs (e.g. merge-commit-only repos);
default to `--squash`. If the merge is blocked (required reviews, branch protection, not
mergeable), do not force it — leave the PR open and report why in Phase 8. A blocked merge is
a reporting outcome, not an emergency.

## Phase 7 — Sync issues (project-local skill)

If this project ships its own `sync-issues` skill and an issue is in play
(`ISSUE_NUMBER` set), update its status:

```bash
test -f "$MAIN_REPO/.claude/skills/sync-issues/SKILL.md" && echo exists
```

If it exists: `Skill(skill: "sync-issues", args: "<ISSUE_NUMBER>")`. Best-effort — if absent,
skip silently; if it errors, note it and continue. A sync failure never changes the outcome.

## Phase 8 — Summary

Print a dense terminal summary:

```
## One-shot complete — <YYYY-MM-DD HH:mm UTC>

**Task:** <one line>
**Config:** create-issue <y/n> · review <y/n> · merge <y/n>
**Result:** <Merged | PR open, merge-ready | PR open, CI red | Failed | Stopped (emergency)>

- Issue:  #<n> <url>            (or "none")
- PR:     #<n> <url>            (with verdict: merged / merge-ready / needs eyes)
- Tests:  <local: lint/typecheck/test/build ✓ · CI: green|red|none|pending>
- Review: <clean | fixes landed | skipped>

### Caveats / follow-ups
- <anything the implementer or review-and-fix flagged, or "none">

### Next steps
- <only if not fully done: what a human needs to do — inspect a red check, unblock a
  protected merge, etc.>
```

Omit empty sections. If everything landed (merged, or merge-ready with green CI), lead with
one plain sentence and keep it short.

Clean up any worktrees you created that are no longer needed (the implementer removes its own
on success; remove leftover recon/fix worktrees). Leave worktrees from a `failed` or
`emergency` stop in place for inspection and say where they are.

## Emergency protocol

An emergency is the *only* time you stop to ask. It is not "this is hard" or "this is big."
It is one of:
- **Rabbit hole** — a change that causes breaking regressions whose containment spirals the
  work far past the task.
- **XL refactor** — delivering the task correctly demands restructuring a subsystem or
  changing widely-depended-on interfaces.
- **Against intent** — implementing the task faithfully would work against what the app is
  clearly built to do.

When you hit one, stop and use `AskUserQuestion`. State plainly: what the task is, what you
found, why it qualifies (which of the three), and what's already been done (issue opened?
commits? worktree path?). Offer concrete options, e.g.:
- **Proceed anyway** — do the full change despite the size/risk.
- **Narrow the scope** — ship a smaller, safe slice now (say exactly which), leave the rest.
- **Stop here** — leave what exists (issue/worktree) for a human and abort.

Then do what they choose. Emergencies should be rare — if you're invoking this more than
once in a run, you're probably over-escalating; re-read the three definitions and default to
proceeding.

## Notes for the implementer

- **Don't ask questions that aren't emergencies.** Ambiguous business logic, "which of two
  reasonable patterns," edge-case handling — decide, implement, and note the call in the PR
  body. That's the whole point of one-shot.
- **The most common mistake is stopping after a sub-skill or agent returns.** `review-and-fix`
  and the implementer run inside this conversation; when they finish, the next phase is still
  yours. Keep going to Phase 8.
- **Defaults keep "no questions" safe.** No issue and no merge unless asked; those are the
  only actions with lasting external effect. Review is opt-in; CI-green is always pursued.
- **CI green is the merge bar**, not local checks. Never merge on a red or pending pipeline.
- **Sub-skill invocations go through the `Skill` tool**, not Bash or Agent — same loader as a
  slash command. Pass `--yolo` to `oddkit:review-and-fix` so it stays non-interactive.
- **One task, one PR.** If the work naturally splits, ship the coherent whole in one PR;
  don't fan out into multiple PRs (that's burndown's job).
