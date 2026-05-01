---
name: burndown
description: >
  Work through a list of GitHub issues in parallel — recon, plan, implement, test, PR — with one
  upfront Q&A and minimal handholding after. Use when the user wants to burn down a list of issues,
  process multiple issues at once, batch-implement issues, ship a backlog, or says /oddkit:burndown.
  Also trigger when the user says "work through these issues", "knock out these tickets",
  "implement issues #X #Y #Z", or references batch-handling GitHub issues.
argument-hint: "<issue refs...> [--yolo] [--resume <state-file>] [--retry <issue>]"
model: sonnet
---

# Burndown

Take a list of GitHub issues. Recon them all, ask one batched round of clarifying questions,
then fan out one agent per issue — each in its own worktree, each opens its own PR. The
goal: one Q&A session up front, then walk away.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use separate
tool calls or `git -C <path>`. Applies to you and every subagent you spawn.

**Model strategy.** This orchestrator is sonnet. Pass `model:` explicitly on every Agent
call so behavior doesn't depend on inheritance:
- recon (`@oddkit:code-scout`, `@oddkit:impact-scout`) → sonnet
- plan generation → sonnet
- simple-issue implementation → sonnet
- complex-issue implementation → opus
- `@oddkit:intent-checker` (within impl agents) → opus (its default)

## Parse arguments

From `$ARGUMENTS`:
- **Issue refs** (positional): `#\d+`, bare numbers, or GitHub issue URLs.
- **`--yolo`**: skip confirmation gates; spawn impl agents with `mode: "bypassPermissions"`.
- **`--resume <path>`**: resume from a state file → jump to **Resume**.
- **`--retry <issue>`**: with `--resume`, reset that issue's phase.

If no refs and no `--resume`, ask: "Which issues should I burn down? Paste numbers or URLs."
If issue count > 15, warn and ask before continuing (skip the warning in `--yolo`).

### Scope

Burndown opens **one PR per issue** — that's the only mode and what makes parallelism worth
it. For a combined PR, run burndown per issue on a shared branch, or merge resulting PRs
locally.

## Phase 1 — Set up the batch

```bash
git rev-parse --show-toplevel
mkdir -p .burndown-<timestamp>
```

Store as `BATCH_DIR`. Write `<BATCH_DIR>/state.json`:

```json
{
  "batch_id": "burndown-<timestamp>",
  "created_at": "<iso>",
  "issues": [
    {"number": 123, "phase": "pending", "worktree": null, "branch": null, "plan": null, "pr": null, "blocked_by": []}
  ],
  "config": {"base_branch": "main", "yolo": false}
}
```

Per-issue `phase`: `pending → recon → classified → planned → implementing → done | failed | blocked | already_done`.

Refresh state after every phase change so `--resume` works.

Fetch each issue:
```bash
gh issue view <n> --json number,title,body,labels,assignees,url,state,comments
```

Skip closed issues with a warning. Scan body+comments for `depends on #N`, `blocked by #N`,
`after #N`, `requires #N` and add to `blocked_by`.

## Phase 2 — Recon all issues in parallel

For each issue, spawn `@oddkit:code-scout` and `@oddkit:impact-scout` via the Agent tool —
**`model: sonnet` on every call**. Pass the issue title and body as the task. Run all
`2 * len(ISSUES)` calls in one message.

Store findings on each issue as `recon` in state.

## Phase 3 — Classify and detect conflicts

### Classify (you, inline)

For each issue, decide from issue text + recon:

- **already_done**: behavior already exists in the codebase. Skips Q&A, planning, impl —
  comment-only in 7a. Record `evidence`: 1-3 file:line refs from recon that prove it.
  Be conservative — if partial, mark `simple` or `complex` with a note instead.
- **simple**: one or two files, clear behavior, recon gives a direct template. One-shot
  implementable.
- **complex**: multi-file, branching design choices, ambiguous business logic, or wide
  blast radius. Needs a written plan.

Record `complexity` and one-line `rationale` per issue.

### Detect file overlap

Build `file_path -> [issue_numbers]` from each issue's recon "Relevant Files" and
"Dependencies". Files touched by 2+ issues form an **overlap group** — those issues become
a serialized chain (stacked PRs). Order = input order unless recon shows a real dependency
(A defines what B uses). Record `blocked_by` on affected issues.

Issues with no overlaps stay parallel.

## Phase 4 — Batched Q&A

One discovery session covering all issues. Use `AskUserQuestion`. Multiple-choice.
**Skip questions you have a confident answer to** — sharper questions beat blanket coverage.

### 4a. Workflow defaults

Defaults: 1 PR/issue, 1 worktree/issue, base = `main`, commit per plan-phase (complex) or
one commit (simple). Detect main vs master from
`git symbolic-ref refs/remotes/origin/HEAD`.

Ask once: "Use defaults, or customize?" → `Use defaults` / `Customize`. If `Customize`,
ask the override questions. Skip in `--yolo`. Record under `state.config`.

### 4b. Per-issue clarifications (only when needed)

Skip if recon + issue body fully define the work (typical for simple issues with clear
acceptance criteria). Ask only when there's ambiguous business logic, branching design,
scope uncertainty, or unresolved edge cases. Cap 3-5 questions per issue. Group by issue
header (e.g., "Issue #123 — <title>"). Send up to 4 questions per call.

After each multiple-choice answer, restate the chosen option by full text before the next
question (per project convention).

If a clarification names a file/component recon didn't surface, re-run recon for that
issue before its plan.

Record under each issue as `clarifications`.

## Phase 5 — Generate plans for complex issues

For each `complex` issue, spawn an Agent **with `model: sonnet`**. Run all plan-generation
agents in parallel. Use the prompt in `references/plan-handoff.md`, substituting issue,
recon, and clarifications.

Save each plan to `<BATCH_DIR>/plans/issue-<n>.plan.md`. Record path on the issue as `plan`.

Simple issues skip planning — implemented directly with issue + recon as context.

## Phase 6 — Confirm and fan out

Show the developer:

```
## Burndown — {N} issues

### Already complete ({P} — comment + skip)
- #100 <title> — recon found existing impl at <file:line>. No PR opened; an issue comment
  will be posted explaining the finding.

### Parallel cohort ({M})
- #123 <title> — simple — implement directly
- #456 <title> — complex — plan: .burndown-<ts>/plans/issue-456.plan.md

### Serialized chain ({K} — share files)
- #789 <title> — runs first
- #790 <title> — based on #789's branch (stacked PR)

> Stacked PRs must merge in order. After predecessor merges, retarget the dependent's PR:
> `gh pr edit <pr> --base main`.

### Workflow
- 1 PR per issue, 1 worktree per issue, base = `main`
- Commits per plan-phase (complex) / one commit (simple)
- Retry: 1 attempt on failure, then surface for inspection
- Every issue gets a resolution comment posted at the end

Proceed? (yes / abort)
```

Wait for confirmation unless `--yolo`. On abort, leave `BATCH_DIR` and state in place —
`--resume` picks up later.

If the developer flags an `already_done` as misclassified, reclassify (re-running plan
generation if the new classification is `complex`) before fan-out.

## Phase 7 — Implement, verify, PR

### 7a. already_done issues

Post the "Already complete" comment from `references/comments.md` using each issue's
recorded `evidence` and `rationale`. Mark phase `already_done`. No agent, no worktree.

### 7b. Implementation agents

For each remaining issue, spawn an Agent using the handoff in `references/impl-handoff.md`.
**Model:** `sonnet` for `simple`, `opus` for `complex`. In `--yolo`, also pass
`mode: "bypassPermissions"`.

- **Parallel cohort**: fire all in one message (multiple Agent calls). Wait for all to
  finish before moving on.
- **Serialized chain**: fire the head; when it returns, fire the next with the
  predecessor's branch as `<base>` and `--base burndown/issue-<predecessor>-<slug>` for
  the PR. If the head fails, mark dependents `blocked` and skip — don't propagate a
  broken chain.

Update state after each agent returns: `phase`, `pr`, `worktree`, `branch`. Don't batch.

### 7c. Post resolution comments

After each agent returns (or after marking dependents `blocked`), post one comment per
issue using `references/comments.md`. The orchestrator posts — never the impl agent. This
keeps formatting consistent across done/failed/blocked/already-done and gives a single
retry path.

If a comment post fails (network/auth), log `comment_error: <reason>` to state and
continue. The final report flags issues whose comments didn't post.

## Phase 8 — Final report

```
## Burndown Complete — {N} issues

### Shipped ({M} PRs)
- #123 → <PR URL> — tests pass, plan compliance pass — comment posted

### Already complete ({P})
- #100 — recon found existing impl — comment posted

### Failed ({K})
- #789 — <one-line reason>. Worktree: .burndown-<ts>/issue-789 — comment posted

### Blocked ({L})
- #790 — predecessor #789 failed — comment posted

### Comments that didn't post ({Q})
- #456 — <reason>. Hand-post: gh issue comment 456 --body-file <BATCH_DIR>/comments/issue-456.md

### Next steps
- Review the PRs (consider /oddkit:review <PR>)
- For failures: cd <worktree> and inspect, or rerun: /oddkit:burndown --resume <state-file>
```

If any comment failed to post, write the intended body to
`<BATCH_DIR>/comments/issue-<n>.md`. Don't retry comment posts in the same run — flaky
network shouldn't bounce the whole batch.

Don't auto-clean worktrees. Failed and blocked issues need them for inspection.
Cleanup hint: `git worktree remove <BATCH_DIR>/issue-<n>` once a PR is merged.

## Resume

Read state. Per issue:
- `pending` / `recon` → restart Phase 2
- `classified` → restart Phase 4 (skip already-answered)
- `planned` → restart Phase 7
- `implementing` → re-spawn impl agent with the same handoff. Worktree may exist; the
  agent should detect and continue from current branch state.
- `done` / `failed` / `blocked` / `already_done` → leave alone, report at end

If an issue is at `done|failed|blocked|already_done` with no `comment_error` and no
comment timestamp, the previous run died after the agent finished but before the comment
posted. Re-post using state data, then move on.

`--retry <issue>` resets that issue's phase to `planned` (or `classified` if no plan) and
clears its `comment` so the new outcome posts a fresh comment.

## Notes for the implementer

- One worktree per issue, always — that's the parallelism boundary.
- A new worktree may need `pnpm install` / `npm install` / `bundle install` / etc. Detect
  the lockfile and run install before tests if needed. Note this in the PR body if it
  added time.
- Write to state immediately after each agent returns. A session crash mid-fan-out
  shouldn't lose progress.
- Don't ask the user during fan-out. The whole point is one Q&A then walk away. Agents
  pick the most reasonable option for genuine forks and note it in the PR body.
- File-overlap detection is heuristic over recon output. False negatives are possible —
  real conflicts at PR time are the human's call.
- Stacked PRs: don't auto-retarget on merge. Leave it as a manual step in the report.
