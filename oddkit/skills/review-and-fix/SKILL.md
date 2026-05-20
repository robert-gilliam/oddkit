---
name: review-and-fix
description: >
  Autonomous review + fix loop. Runs the review agents, fixes everything they find, posts inline
  comments on each fixed (or deferred) location, and opens follow-up GitHub issues for any work
  that's too sprawling to fix in-place. No confirmation prompts, no permission asks — finish the job.
  Use when the user wants to review and fix a PR or branch in one shot, ship review fixes
  hands-off, "review and fix it", "fix everything the review finds", or says /oddkit:review-and-fix.
argument-hint: "[#PR or branch] [--dry-run]"
---

# Review and Fix

End-to-end loop: find issues with the review agents, fix them in code, leave a clean trail on the PR. Runs autonomously — no confirmation prompts, no "should I push?" asks. If a finding is too sprawling to fix safely, defer it to a follow-up GitHub issue instead of asking the user.

The skill is essentially `/oddkit:review` and `/oddkit:address-feedback` collapsed into one pass — but it skips posting findings to GitHub just to read them back. Findings flow directly from reviewer to fixer in memory.

## Parse arguments

Extract from `$ARGUMENTS`:
- **PR reference**: `#\d+`, `/pull/\d+`, GitHub URL, or branch name with an open PR → **PR mode**
- **No PR reference, current branch has open PR** → **PR mode** on the current branch
- **No PR reference, no open PR** → **local mode** (review + fix HEAD vs main, no GitHub)
- **`--dry-run`**: do everything except commit/push/post — print what would happen

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

## Phase 2 — Set up worktree

Create one worktree for the whole skill — agents read code at the right SHA, fixes get committed in isolation.

```bash
mkdir -p .oddkit/worktrees
```

**PR mode**: worktree on the PR's head branch (we'll commit fixes onto it).

```bash
git fetch origin <HEAD_BRANCH>
git worktree add .oddkit/worktrees/review-and-fix-<timestamp> origin/<HEAD_BRANCH>
```

**Local mode**: worktree at the current HEAD (we'll commit fixes onto the current branch).

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git worktree add .oddkit/worktrees/review-and-fix-<timestamp> "$CURRENT_BRANCH"
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
**intent-checker**: gets `PR_BODY` (PR mode only). Skip this agent in local mode (no stated intent to check against).
**design-critic**: gets `PR_BODY` if available. Search for existing patterns that could simplify.

Each agent must quote exact code snippets for every finding.

### Plan review → 3 agents in parallel

If the diff is markdown/docs only, spawn `@oddkit:fact-checker`, `@oddkit:completeness-auditor`, `@oddkit:design-critic` with the same diff/scope inputs. Plan review still benefits from fixing — typos, factually wrong references, missing sections.

## Phase 4 — Verify findings

Same verification as `/oddkit:review`:

1. Parse structured output from each agent.
2. Deduplicate — if multiple agents flagged the same snippet for the same root cause, merge. Keep highest severity. Note which agents flagged it.
3. For every finding, read the file in `WORK_DIR`, search for the quoted snippet, check ~20 lines of context, trace callers/types as needed.
4. **Discard** if: snippet doesn't exist, issue doesn't exist in actual code, issue is handled elsewhere, concern is theoretical.

Keep the count of discarded findings as `DISCARDED`.

## Phase 5 — Classify each surviving finding

For each finding, decide one of:

| Class | Criteria | Action |
|-------|----------|--------|
| **Fix** | Real issue, fix fits in the affected file or 1-2 adjacent files, doesn't change public interfaces or behavior contracts | Implement the fix |
| **Fix-with-care** | Real issue, fix touches more files or has nuance, but still tractable in one session | Implement the fix, note carefully in commit message |
| **Defer** | Issue is **both** important enough to track and so sprawling it can't land in this PR — would require restructuring, schema changes, breaking API changes, or multi-system coordination, AND leaving it unaddressed would meaningfully hurt correctness, security, performance, or maintainability | Create follow-up GitHub issue (mandatory), leave acknowledged comment |
| **Drop** | Real issue but minor enough that no one would prioritize the follow-up — nits, style preferences, micro-optimizations, "would be nicer if", or anything that's a judgment call rather than a clear correctness/quality problem | Don't fix, don't track, don't comment. Mention briefly in the terminal summary so the trail isn't silent. |

**Bias toward fixing.** The default is to do the work, not duck it. Touching multiple files is not by itself a reason to defer — that's just Fix-with-care.

**Defer is the rarest outcome.** Two conditions, both required:
- **Sprawling fix** — restructuring, schema changes, breaking API changes, or multi-system coordination. Not "this would touch 5 files" — that's Fix-with-care. Genuinely "I'd be redesigning a subsystem."
- **Important enough to follow up** — if no one would actually pick up the follow-up issue, the finding doesn't deserve a follow-up issue. Drop it instead.

If only the first condition is met (sprawling but not important), Drop. If only the second is met (important but tractable), do the work — Fix or Fix-with-care.

When in doubt between Fix-with-care and Defer, pick Fix-with-care. When in doubt between Defer and Drop, pick Drop — a follow-up issue that no one prioritizes is just noise, and the reviewer agents are not infallible.

## Phase 6 — Implement fixes

For each Fix and Fix-with-care finding, in `WORK_DIR`:

1. Make the change.
2. Verify the surrounding code still makes sense.
3. Stage the change.
4. Commit with message: `Address review: <one-line description>` (use HEREDOC for multi-line if needed, ending with Claude co-author trailer per repo convention).

Group commits when multiple findings share a root cause (e.g., the same null-safety pattern fixed in three places → one commit).

If a fix breaks tests or produces something obviously wrong on second look, try the next most reasonable approach before giving up — re-read the failing test, re-read the surrounding code, consider whether the original finding was a true positive. Reclassifying as Defer is a last resort, not the first response to friction. If after a genuine second attempt the fix still doesn't work cleanly, then reclassify — to **Drop** if the finding is minor, or to **Defer** only if both Defer conditions in Phase 5 are met.

After all fixes are committed, record each fix's commit SHA and the file/line where the fix landed in the post-fix code. You'll need these for the PR comments.

## Phase 7 — Create follow-up issues for deferred work

This applies only to **Defer** findings — not Drop. Dropped findings get a brief
mention in the terminal summary and nothing more (no issue, no PR comment, no
tracking).

**For each Defer finding, this phase is mandatory.** Don't skip it. Don't ask the user. Just create the issue. If you find yourself with many "defers," that's a signal you're under-fixing — revisit the classification before creating issues for them.

For each Defer finding, in PR mode:

```bash
gh issue create \
  --title "Follow-up from PR #<PR_NUMBER>: <short description>" \
  --body "$(cat <<'EOF'
Surfaced during /oddkit:review-and-fix on PR #<PR_NUMBER>.

**Finding** ({Severity}, flagged by {Agent})

{Issue description}

**Why deferred:** {explanation — typically: too sprawling for in-PR fix, would require restructuring, would break unrelated callers, etc.}

**Where in code:** `{file}:{line}` (as of <HEAD_SHA>)

> {code snippet}

**Suggested approach:** {one-line direction if obvious, otherwise omit}
EOF
)"
```

Store the new issue numbers as `FOLLOWUP_ISSUES` (a list of `{finding_id, issue_number, issue_url}`).

In local mode, there's no PR/repo context for follow-up issues. Instead, write deferred findings to `.oddkit/review-and-fix-<timestamp>-deferred.md` in the repo root with the same content shape, and note the file path in the terminal output. Don't try to create issues against an arbitrary repo without confirmation.

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

- All findings fixed (or dropped), no defers → `Ready to merge`
- Some fixes landed, no blocking defers outstanding → `Fix then merge` (here "fix" usually means human eyes on the diff)
- Deferred findings include something that blocks merging → `Needs reworking`

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

For each **deferred** finding, anchor on the original file/line and post:

```
**Acknowledged, deferred** — [{Agent}]

{Issue, one sentence.}

**Why deferred:** {one-sentence reason}.

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

Reviewed: {N} issue(s) — {FIXED_COUNT} fixed, {DEFERRED_COUNT} deferred to follow-up, {DROPPED_COUNT} minor items judged not worth tracking.
{Discarded count} finding(s) removed during verification.

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

**Verdict:** {VERDICT}

### Fixed ({N})
- {file}:{line} — {one-line description} ({commit_sha})

### Deferred ({N})
- {file}:{line} — {one-line description} → #{issue_number} ({issue_url})

### Dropped ({N})
- {file}:{line} — {one-line description}. {Why dropped: minor / nit / judgment call.}

### Discarded during verification ({N})

{PR link if PR mode}
```

Remove the worktree:

```bash
git worktree remove <WORK_DIR> --force
```

In `--dry-run`, also note: "Dry run — no commits, pushes, comments, or issues were created."

## Failure handling

- **Agent finds nothing**: nothing to fix. Post a summary review (PR mode) with "Reviewed: 0 issues found." and `APPROVE` / `Ready to merge`. Skip phases 5-7.
- **All findings discarded during verification**: same as above — report the discards in the summary so it's clear the reviewers ran.
- **Fix attempt produces broken code**: reclassify that finding as Defer, roll back the working-copy change (don't commit it), and continue with the rest.
- **Push fails** (e.g., remote moved): leave commits in `WORK_DIR`, report the failure with the worktree path, do not remove the worktree.
- **Issue creation fails for a deferred finding**: do not silently drop it. Report the failure clearly in the terminal summary and exit non-zero in spirit (the trail is incomplete).

## What this skill does NOT do

- Does **not** prompt for confirmation. Autonomous means autonomous.
- Does **not** read or reply to existing human review comments — that's `/oddkit:address-feedback`. This skill operates on the review *it just generated*.
- Does **not** rebase, squash, or rewrite history.
- Does **not** force-push. If a normal push is rejected, surface the error.
