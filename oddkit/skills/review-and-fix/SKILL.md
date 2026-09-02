---
name: review-and-fix
description: >
  Autonomous review + fix loop that finishes the work. Runs the review agents, checks the PR
  against its source issue's requirements, fixes everything found, loops until clean, and leaves a
  clean trail on the PR. Defaults to finishing every fix in-place — never punts sprawling work to a
  follow-up issue. No confirmation prompts, no permission asks. Use when the user wants to review
  and fix a PR or branch in one shot, fully implement an issue, ship review fixes hands-off,
  "review and fix it", "fix everything the review finds", or says /oddkit:review-and-fix.
argument-hint: "[#PR or branch] [--dry-run] [--allow-defer]"
---

# Review and Fix

End-to-end loop: find issues with the review agents, confirm the PR actually implements its source issue, fix everything in code, loop until clean, and leave a clean trail on the PR. Runs autonomously — no confirmation prompts, no "should I push?" asks.

**The default is to finish the job.** Every real finding gets fixed in-place — sprawling fixes included — and every requirement in the source issue gets implemented. Work is never punted to a follow-up issue just because it's large. The one exception is a genuine last resort: a specific piece that truly can't land autonomously — needs a credential or external system you don't have, a human design decision, or a fix that keeps breaking after real attempts. That one piece gets a follow-up issue, gets reported loudly, and downgrades the verdict; everything else still ships.

`--allow-defer` restores the conservative behavior: sprawling-and-important findings go to follow-up issues instead of being fixed in-place.

Findings flow directly from reviewer to fixer in memory — the skill never posts findings to GitHub just to read them back.

## Parse arguments

Extract from `$ARGUMENTS`:
- **PR reference**: `#\d+`, `/pull/\d+`, GitHub URL, or branch name with an open PR → **PR mode**
- **No PR reference, current branch has open PR** → **PR mode** on the current branch
- **No PR reference, no open PR** → **local mode** (review + fix HEAD vs main, no GitHub)
- **`--dry-run`**: do everything except commit/push/post — print what would happen
- **`--allow-defer`**: conservative mode. Defer sprawling-and-important findings to follow-up issues instead of fixing them in-place (the pre-completion behavior). Off by default — by default the skill finishes the work.

## Phase 1 — Resolve target

### PR mode

```bash
gh pr view <ref or current branch> --json number,title,body,state,headRefName,headRefOid,baseRefName,url
gh repo view --json owner,name
```

Store `PR_NUMBER`, `PR_BODY`, `HEAD_SHA`, `HEAD_BRANCH`, `BASE_BRANCH`, `OWNER`, `REPO`, `PR_URL`, `PR_STATE`.

If `PR_STATE` is not `OPEN`, stop: "PR #<n> is <state>. Reopen it or pick an open PR."

Verify local branch is up-to-date with origin. If not, stop: "Local branch is out of sync with origin. Pull or push first."

Get GitHub's canonical diff — the authoritative source for the PR:

```bash
gh pr diff <PR_NUMBER>
gh pr diff <PR_NUMBER> --name-only
```

Store as `PR_DIFF` and `PR_FILES`.

### Local mode

```bash
git fetch origin main
git update-ref refs/heads/main refs/remotes/origin/main
git diff main...HEAD
git diff main...HEAD --stat
```

Store as `LOCAL_DIFF` and `DIFF_STAT`. If empty, stop: "No changes found. Nothing to review."

If diff exceeds 5,000 lines, warn once and continue (autonomous — don't block on confirmation).

### Source issue — the spec of "done"

The PR exists to satisfy something. Find what:

- **PR mode**: parse `PR_BODY` for `Closes #N` / `Fixes #N` / `Resolves #N`, and check `.oddkit/burndown-issue-tracking/` if present. For each linked issue:

  ```bash
  gh issue view <N> --json number,title,body
  ```

  Store the combined requirements (acceptance criteria, checklists, "must" statements) as `ISSUE_SPEC`. If the PR links no issue, fall back to `PR_BODY` as the spec.
- **Local mode**: no issue or PR. Derive a loose spec from recent commit messages / branch intent, or skip the completeness check if there's nothing meaningful to compare against.

`ISSUE_SPEC` is the authoritative list of what the change must accomplish. In default mode the skill checks the code against it and implements anything missing — an unimplemented requirement is a finding, not optional polish. Under `--allow-defer`, an unimplemented requirement can be deferred like any other finding.

## Phase 2 — Set up worktree

Create one worktree for the whole skill — agents read code at the right SHA, fixes get committed in isolation.

```bash
mkdir -p .claude/worktrees
```

Code worktrees live under `.claude/worktrees/` — the harness only lets an agent enter and
write in worktrees there, so one under `.oddkit/` blocks every edit until it's relocated.
Durable `.oddkit/` state is unaffected.

**PR mode**: worktree on the PR's head branch (we'll commit fixes onto it).

```bash
git fetch origin <HEAD_BRANCH>
git worktree add .claude/worktrees/review-and-fix-<timestamp> origin/<HEAD_BRANCH>
```

**Local mode**: worktree at the current HEAD (we'll commit fixes onto the current branch).

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git worktree add .claude/worktrees/review-and-fix-<timestamp> "$CURRENT_BRANCH"
```

Store the worktree path as `WORK_DIR`. **All** subsequent file reads, code searches, and edits use `WORK_DIR`.

## Phase 3 — Run review agents

Examine the diff to determine content type:

- **Code**: source files (.ts, .js, .py, .go, .rs, etc.)
- **Plan/docs**: only markdown, text, or documentation

If mixed, treat as code review.

### Code review → 3 agents in parallel

Spawn `@oddkit:correctness`, `@oddkit:intent-checker`, `@oddkit:design-critic` using the Agent tool, in a single message.

All three agents get:
- The diff (`PR_DIFF` for PR mode, `LOCAL_DIFF` for local)
- "Search the codebase at `WORK_DIR` (not the repo root) for all file reads, globs, and greps."
- For PR mode, also: file list `PR_FILES` with "Only report findings in these files."

**correctness**: no PR description — mechanical review of what breaks.
**intent-checker**: gets `PR_BODY` and `ISSUE_SPEC`. Frame it: "Compare the code against the requirements in the source issue (`ISSUE_SPEC`) and the PR description. Flag every requirement that is not fully implemented as a finding — these are gaps to fix, not optional polish." Skip this agent in local mode unless a spec was derived.
**design-critic**: gets `PR_BODY` if available. Search for existing patterns that could simplify.

Each agent must quote exact code snippets for every finding.

### Plan review → 3 agents in parallel

If the diff is markdown/docs only, spawn `@oddkit:fact-checker`, `@oddkit:completeness-auditor`, `@oddkit:design-critic` with the same diff/scope inputs. Pass `ISSUE_SPEC` to completeness-auditor so it flags requirements the plan doesn't cover. Plan review still benefits from fixing — typos, factually wrong references, missing sections.

## Phase 4 — Verify findings

Same verification as `/oddkit:review`:

1. Parse structured output from each agent.
2. Deduplicate — if multiple agents flagged the same snippet for the same root cause, merge. Keep highest severity. Note which agents flagged it.
3. For every finding, read the file in `WORK_DIR`, search for the quoted snippet, check ~20 lines of context, trace callers/types as needed.
4. **Discard** if: snippet doesn't exist, issue doesn't exist in actual code, issue is handled elsewhere, concern is theoretical.

**Completeness findings (a missing `ISSUE_SPEC` requirement)** are the exception to the snippet rule — there's no snippet because the code doesn't exist yet. Verify these by confirming the requirement genuinely isn't implemented anywhere in `WORK_DIR` (grep for related functions, routes, config, tests). If it's actually implemented elsewhere, discard. If genuinely absent, keep it as a Fix.

Keep the count of discarded findings as `DISCARDED`.

## Phase 5 — Classify each surviving finding

For each finding (including unmet `ISSUE_SPEC` requirements), decide:

| Class | Criteria | Action |
|-------|----------|--------|
| **Fix** | Real issue, fix fits in the affected file or 1-2 adjacent files, doesn't change public interfaces or behavior contracts | Implement the fix |
| **Fix-with-care** | Real issue, fix touches more files or has nuance, but still tractable in this session | Implement the fix, note carefully in commit message |
| **Drop** | Real issue but minor enough that no one would prioritize a follow-up — nits, style preferences, micro-optimizations, "would be nicer if", judgment calls rather than clear correctness/quality problems | Don't fix, don't track, don't comment. Mention briefly in the terminal summary. |
| **Defer** | *(only under `--allow-defer`)* Issue is **both** important enough to track **and** so sprawling it can't land in this PR — restructuring, schema changes, breaking API changes, or multi-system coordination | Create follow-up GitHub issue (mandatory), leave acknowledged comment |

**Default mode: there is no Defer.** Every real finding is Fix or Fix-with-care; minor ones are Drop. Sprawling is not a reason to defer — a fix that touches many files or restructures a subsystem is still Fix-with-care, just done with more care and more verification. The job is to finish the work, `ISSUE_SPEC` requirements included. The only escape from finishing is the genuine last resort handled in Phase 6 — not a class you reach for up front.

**`--allow-defer` mode** adds the Defer class back. Both conditions are required: sprawling AND important enough that someone would actually pick up the follow-up. If only sprawling, Drop. If only important, do the work. When in doubt between Fix-with-care and Defer, pick Fix-with-care; between Defer and Drop, pick Drop — a follow-up no one prioritizes is just noise, and the reviewer agents are not infallible.

## Phase 6 — Implement fixes, loop until clean

For each Fix and Fix-with-care finding, in `WORK_DIR`:

1. Make the change.
2. Verify the surrounding code still makes sense.
3. Stage the change.
4. Commit with message: `Address review: <one-line description>` (use HEREDOC for multi-line if needed, ending with the Claude co-author trailer per repo convention).

Group commits when multiple findings share a root cause (e.g., the same null-safety pattern fixed in three places → one commit).

### When a fix fights back

If a fix breaks tests or produces something obviously wrong on second look, try the next most reasonable approach before giving up — re-read the failing test, re-read the surrounding code, reconsider whether the original finding was a true positive. Friction is not a reason to stop.

- **`--allow-defer` mode**: if after a genuine second attempt it still won't land cleanly, reclassify — **Drop** if minor, **Defer** if both Phase 5 Defer conditions hold.
- **Default mode**: there is no routine defer. Drop it only if it turns out minor. The **last-resort follow-up** below is reserved for the rare piece that genuinely cannot be completed autonomously — not for fixes that are merely hard or large.

### Last-resort follow-up (default mode)

A piece qualifies as last-resort *only* when finishing it autonomously is impossible, not just big: it needs a credential or external system you don't have, a human design decision you can't make, or a fix that keeps breaking after real attempts. When that happens, create a single follow-up issue for **just that piece** (Phase 7), finish everything else, report it loudly, and downgrade the verdict. Do not route sprawling-but-doable work here — that's the exact trap this skill exists to avoid. One or two last-resort follow-ups across a run is plausible; more than that means you're punting work that should have been fixed — go back and fix it.

### Re-review loop

Big fixes can introduce new problems, and a completeness fix can leave loose ends. After a round of fixes, re-run a lightweight check on the **new** diff (current `WORK_DIR` vs base): re-run the review agents on the changed hunks and re-check unmet `ISSUE_SPEC` requirements. Feed any new actionable findings back through Phases 4–6.

Stop when a pass surfaces nothing actionable **and** every `ISSUE_SPEC` requirement is implemented (or sent to a last-resort follow-up). Cap at 3 rounds — if you're still finding substantive issues after three, the change needs human eyes: finish what you can, downgrade the verdict, and say so in the summary.

### Verify before claiming done

Before finishing, run the project's build/test command in `WORK_DIR` if one exists (check `package.json`, `Makefile`, `pyproject.toml`, repo conventions). "All requirements met" must be backed by green tests, not asserted. If tests fail and you can't fix them in-loop, report it — don't claim completion.

After all fixes are committed, record each fix's commit SHA and the file/line where the fix landed in the post-fix code. You'll need these for the PR comments.

## Phase 7 — Create follow-up issues

Two things land here:
- **`--allow-defer` mode**: every **Defer** finding (mandatory — don't skip, don't ask).
- **Default mode**: only the rare **last-resort** piece from Phase 6 that genuinely couldn't be completed. If you have more than one or two, you're punting work that should have been fixed — go back to Phase 6.

Neither applies to **Drop** (brief terminal mention only) or to normal fixed findings.

For each such finding, in PR mode:

```bash
gh issue create \
  --title "Follow-up from PR #<PR_NUMBER>: <short description>" \
  --body "$(cat <<'EOF'
Surfaced during /oddkit:review-and-fix on PR #<PR_NUMBER>.

**Finding** ({Severity}, flagged by {Agent})

{Issue description}

**Why not done in this PR:** {explanation — for `--allow-defer`: too sprawling for an in-PR fix, would break unrelated callers, etc. For a last-resort follow-up: what made it impossible to finish autonomously — missing credential/system, needs a human decision, fix kept breaking.}

**Where in code:** `{file}:{line}` (as of <HEAD_SHA>)

> {code snippet}

**Suggested approach:** {one-line direction if obvious, otherwise omit}
EOF
)"
```

Store the new issue numbers as `FOLLOWUP_ISSUES` (a list of `{finding_id, issue_number, issue_url, reason}` where `reason` is `deferred` or `last-resort`).

In local mode, there's no PR/repo context for follow-up issues. Instead, write these findings to `.oddkit/review-and-fix-<timestamp>-deferred.md` in the repo root with the same content shape, and note the file path in the terminal output. Don't create issues against an arbitrary repo without confirmation.

## Phase 8 — Push (PR mode only)

If `--dry-run`, skip this phase and Phase 9 — print what would have happened and stop.

Re-check PR state immediately before pushing:

```bash
gh pr view <PR_NUMBER> --json state
```

If not `OPEN`, stop with the local commits intact and clearly report: "PR #<n> closed/merged while we worked. Commits remain on `<HEAD_BRANCH>` in `WORK_DIR`."

Otherwise push:

```bash
git -C <WORK_DIR> push origin <HEAD_BRANCH>
```

After push, get the new `HEAD_SHA` from `gh pr view` again — inline comments must anchor on the latest commit.

## Phase 9 — Post the PR trail (PR mode only)

Pick a verdict for the summary review:

- Everything fixed (or dropped), all `ISSUE_SPEC` requirements implemented, tests pass, no follow-ups → `Ready to merge`
- Fixes landed and tests pass, but human eyes on the diff are warranted → `Fix then merge`
- A last-resort follow-up or unmet requirement blocks the issue, tests don't pass, or the loop hit its cap with issues outstanding → `Needs reworking`

Drop'd findings don't affect the verdict — they were judged not worth tracking.

Map to GitHub review event:
- Ready to merge / Fix then merge → `APPROVE`
- Needs reworking → `COMMENT`

Store as `VERDICT` and `REVIEW_EVENT`.

### 9a. Create a pending review

Use the GitHub MCP review tools if available:

Call `mcp__plugin_github_github__pull_request_review_write` with:
- `method: "create"`
- `owner`, `repo`, `pullNumber: PR_NUMBER`
- `commitID: HEAD_SHA` (the new one, post-push)
- Omit `event` — creates a pending review.

### 9b. Add inline comments

For each **fixed** finding, call `mcp__plugin_github_github__add_comment_to_pending_review` anchored on the post-fix file/line:

```
**Fixed** — [{Agent}]

{One-sentence description of what was changed.}

Commit: {short_sha}
```

For each finding sent to a **follow-up issue** (Defer under `--allow-defer`, or a last-resort piece), anchor on the original file/line and post:

```
**Tracked in follow-up** — [{Agent}]

{Issue, one sentence.}

**Why not done here:** {one-sentence reason — deferred as out of scope, or couldn't be finished autonomously}.

Follow-up: #{issue_number}
```

If a fixed finding's line no longer exists (the fix removed the line), anchor the comment on the nearest surviving line in the same hunk and adjust the body: "Fixed at {file}:{new_line} — original line removed."

One comment per unique finding. No duplicates.

### 9c. Submit the review

Call `mcp__plugin_github_github__pull_request_review_write` with:
- `method: "submit_pending"`
- `owner`, `repo`, `pullNumber: PR_NUMBER`
- `event: REVIEW_EVENT`
- `body`:

```
{One sentence of specific praise — name a concrete thing that works.}

**Recommendation:** {VERDICT}.

Reviewed: {N} issue(s) — {FIXED_COUNT} fixed, {FOLLOWUP_COUNT} tracked in follow-up, {DROPPED_COUNT} minor items judged not worth tracking.
{Discarded count} finding(s) removed during verification. Tests: {pass/fail/n-a}.

{If FOLLOWUP_ISSUES is non-empty:}
Follow-ups: {comma-separated #issue refs}
```

### 9d. Fallback (no MCP review tools)

If the MCP tools aren't available, post a single PR comment with the same content, using full SHA links to file/line locations: `https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{path}#L{start}-L{end}`.

## Phase 10 — Output and clean up

Print a terminal summary:

```
## Review and Fix — {target}

{DIFF_STAT}

**Verdict:** {VERDICT}   |   Tests: {pass/fail/n-a}

### Fixed ({N})
- {file}:{line} — {one-line description} ({commit_sha})

### Tracked in follow-up ({N})
- {file}:{line} — {one-line description} → #{issue_number} ({issue_url}) — {deferred | last-resort}

### Dropped ({N})
- {file}:{line} — {one-line description}. {Why dropped: minor / nit / judgment call.}

### Discarded during verification ({N})

{PR link if PR mode}
```

If any `ISSUE_SPEC` requirement went to a last-resort follow-up or remains unmet, call it out explicitly at the top of the summary — this is the work that didn't ship, and it must not be buried.

Remove the worktree:

```bash
git worktree remove <WORK_DIR> --force
```

In `--dry-run`, also note: "Dry run — no commits, pushes, comments, or issues were created."

## Failure handling

- **Agent finds nothing and all `ISSUE_SPEC` requirements are met**: nothing to fix. Post a summary review (PR mode) with "Reviewed: 0 issues found." and `APPROVE` / `Ready to merge`. Skip phases 5-7.
- **All findings discarded during verification**: same as above — report the discards in the summary so it's clear the reviewers ran.
- **Fix attempt produces broken code**: roll back the working-copy change (don't commit it) and retry per Phase 6. Only if it still won't land: Drop (if minor) or — default mode — a last-resort follow-up; `--allow-defer` mode — Defer. Continue with the rest either way.
- **Tests fail and can't be fixed in-loop**: do not claim completion. Report the failure in the summary and set the verdict to `Needs reworking`.
- **Push fails** (e.g., remote moved): leave commits in `WORK_DIR`, report the failure with the worktree path, do not remove the worktree.
- **Issue creation fails for a follow-up finding**: do not silently drop it. Report the failure clearly in the terminal summary and exit non-zero in spirit (the trail is incomplete).

## What this skill does NOT do

- Does **not** prompt for confirmation. Autonomous means autonomous.
- Does **not** punt sprawling-but-doable work to a follow-up issue (unless `--allow-defer`). Large fixes get done.
- Does **not** read or reply to existing human review comments — that's `/oddkit:address-feedback`. This skill operates on the review *it just generated*.
- Does **not** rebase, squash, or rewrite history.
- Does **not** force-push. If a normal push is rejected, surface the error.
