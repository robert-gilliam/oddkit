---
name: address-feedback
description: >
  Address GitHub PR review comments end-to-end: fetch, evaluate, fix, respond.
  Use when the user wants to address PR feedback, fix review comments, or says /oddkit:address-feedback.
argument-hint: "[#PR or branch] [--yolo]"
---

# Address PR Feedback

Fetch unresolved PR review comments, evaluate each against the actual code, implement fixes, and post responses.

## Parse arguments

Extract from `$ARGUMENTS`:
- **PR reference**: `#\d+`, `/pull/\d+`, GitHub URL, or branch name
- **`--yolo`**: fully autonomous mode. Don't pause for review of categorized items;
  implement every Fix and Fix-with-care from Phase 4c, deferring only what genuinely
  meets the Defer bar (sprawling restructures, schema changes, multi-system
  coordination). Also skips the Phase 6 push/post confirmation. The point of `--yolo`
  is to do the work, not punt it. Set automatically when invoked from
  `/oddkit:burndown-ship`.

## Phase 1 — Identify the PR

```bash
gh pr view <ref or current branch> --json number,title,body,state,headRefName,baseRefName,url
```

Store `PR_NUMBER`, `HEAD_BRANCH`, `BASE_BRANCH`, `PR_URL`, `PR_STATE`.

If no PR found, stop: "No open PR found. Specify a PR number or switch to a branch with an open PR."

If `PR_STATE` is not `OPEN`, stop: "PR #<n> is <state>. Reopen it or pick an open PR."

Verify local branch is up-to-date with origin. If not, stop: "Local branch is not up-to-date with origin. Pull or push first."

## Phase 1.5 — Check for vet-prs context

Before setting up the workspace, check whether a vet-prs verdict exists for this PR:

```bash
MAIN_REPO=$(git rev-parse --show-toplevel)
VET_STATE="$MAIN_REPO/.oddkit/vet-prs/${PR_NUMBER}.json"
```

If the file exists, read it. The `concerns` array lists specific issues the vet-prs triage flagged. These concerns are **why this PR was routed to address-feedback** — they must be evaluated against the actual code in Phase 4, with the same rigor as a human reviewer's inline comment.

If the file is missing, proceed normally.

## Phase 2 — Set up workspace

Check current branch first:

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```

If `CURRENT_BRANCH == HEAD_BRANCH` and `git status --porcelain` is empty, use the current directory as `WORK_DIR`. **Otherwise, always create a worktree** — never skip this step and never evaluate code from the wrong branch:

```bash
mkdir -p "$MAIN_REPO/.oddkit/worktrees"
git fetch origin <HEAD_BRANCH>
git worktree add "$MAIN_REPO/.oddkit/worktrees/addr-feedback-<timestamp>" origin/<HEAD_BRANCH>
```

Fetch the base branch for comparison.

Store `WORK_DIR` (the worktree path, or current directory if already on the right branch) for all subsequent file operations.

**Critical:** All file reads in Phase 4 must use `WORK_DIR`. Do NOT use `mcp__plugin_github_github__get_file_contents` with a `branch` parameter to read files — this tool has a known defect where it silently returns the default-branch content instead of the specified branch, making your evaluation wrong. Read from the local worktree path instead.

## Phase 3 — Fetch all comments

Three API endpoints cover the three comment types on a PR:

```bash
# Inline review comments (attached to specific lines/files)
gh api repos/{owner}/{repo}/pulls/{PR_NUMBER}/comments --paginate

# Review bodies (top-level text submitted with Approve/Request Changes)
gh api repos/{owner}/{repo}/pulls/{PR_NUMBER}/reviews --paginate

# General conversation comments (posted in the PR thread, not tied to a file)
gh api repos/{owner}/{repo}/issues/{PR_NUMBER}/comments --paginate
```

Merge all three into a single list. For each, store: `comment_id`, `comment_type` (inline, review, conversation), `path` (if inline), `line` (if inline), `body`, `diff_hunk` (if inline), `user.login`.

Group inline comments by file. Conversation and review-body comments form a separate "general" group.

**Do not filter out comments based on author being a bot, CI system, or automation.**
Comments posted by `oddkit:vet-prs` (marked with `<!-- oddkit:vet-prs -->`) are especially important — the concerns listed there are the primary issues this PR was routed to address. Excluding them because they came from automation is the wrong call: the concerns still need to be evaluated against the actual code. If the vet-prs state file from Phase 1.5 listed non-empty `concerns`, each one appears in that comment and must be evaluated in Phase 4.

Similarly, if you already read vet-prs concerns from Phase 1.5, cross-reference them with what you find in the comment thread — they should match. Use the local state file's structured data as a checklist alongside the comment body.

## Phase 4 — Evaluate each comment

For each comment:

### 4a. Read the actual code

Read the file at the comment's path **from `WORK_DIR`** (the local worktree). At least 30 lines of context. Trace related code paths if needed.

Never read code via `mcp__plugin_github_github__get_file_contents` with a `branch` parameter here — that tool silently returns default-branch content, not the PR branch. Use `Read` tool on the absolute path inside `WORK_DIR`.

### 4b. Evaluate critically

- Is the comment valid? Does the issue exist?
- Is the reviewer's understanding correct? If the code is right, explain why.
- Is there a real problem, but different from what the reviewer described? Fix the real one.

**For vet-prs concerns specifically:** the vet agent only read the diff, not the full file. Its concern may be a false positive — the real code in context makes something clear that wasn't visible in the diff. Read the actual file and decide. A "false positive" is a valid and complete outcome — it still needs an explanatory reply. Do not silently skip a concern just because you suspect it's a false positive; confirm it against the code, then explain why.

### 4c. Categorize

| Category | Criteria | Action |
|----------|----------|--------|
| Fix | Real issue. Fix fits in the affected file or 1-2 adjacent files, doesn't change public interfaces or behavior contracts | Implement the fix |
| Fix-with-care | Real issue. Fix touches more files or has nuance, but still tractable | Implement the fix carefully; note the trade-offs in the commit |
| Disagree | Reviewer misunderstood or the code is correct | Draft explanation grounded in the actual code |
| Defer | Issue is **both** sprawling (restructuring, schema, breaking API, multi-system coordination) **and** important enough that a follow-up issue would actually get picked up — i.e., leaving it unaddressed would meaningfully hurt correctness, security, performance, or maintainability | Acknowledge in reply, explain what's needed to do it properly. No fix. |

**Bias toward fixing.** The default is to do the work, not duck it. Touching multiple
files is not by itself a reason to defer — that's just Fix-with-care.

**Defer is the rarest outcome.** Both conditions must be true: the fix is genuinely
sprawling AND the issue is important enough that someone would actually act on the
follow-up. If only the first is true (sprawling but minor), prefer Disagree with a
polite explanation of why it's not worth changing — don't pretend it's a follow-up
when no one would prioritize it. When in doubt between Fix-with-care and Defer, pick
Fix-with-care.

For "Unclear" comments (you can't tell what the reviewer wants): re-read the code with
fresh eyes, pick the most reasonable interpretation, and proceed. Note the assumption
in the reply so the reviewer can correct it if you guessed wrong.

**Zero-fix does not mean zero-reply.** If every comment evaluates to Disagree (code is
correct, concern is a false positive), the phase still produces reply drafts explaining
why. Posting those replies is the deliverable. Do not exit Phase 6 with a "nothing
actionable found" without having posted at least one reply per concern — silence is not
an acknowledgment.

**Non-`--yolo` mode:** present Fix-with-care, Defer, and Unclear items in the Phase 6
summary so the developer can redirect before push. Don't pause mid-categorize — gather
them all, then summarize.

**Under `--yolo`:** no pause, no shortcuts. Implement every Fix and Fix-with-care item.
Only Defer when the fix genuinely meets the bar above. Auto-deferring just because a
fix is "complex" or "risky" is the wrong call here — the whole point of `--yolo` is to
do the work, not punt it to a follow-up. If a Fix-with-care attempt produces broken
code on second look, reclassify it as Defer rather than committing the bad change.

## Phase 5 — Implement fixes

For each **Fix** and **Fix-with-care** item:
1. Make the change in `WORK_DIR` (take the extra care for Fix-with-care — re-read
   callers, double-check tests still cover the path, etc.)
2. Verify fix in context
3. Stage and commit: `Address review: <brief description>`
4. Draft reply (brief: "Fixed — good catch." or "Fixed; took a slightly different
   approach because <reason>." Don't over-explain.)

For **Disagree** items: draft a respectful explanation grounded in the actual code
behavior. Don't be evasive — quote the relevant lines.

For **Defer** items: draft a reply that acknowledges the issue, explains why it's
out of scope for this PR, and (if appropriate) names what would be needed to do it
properly. No commit, no fix.

Group commits when multiple comments share a root cause.

## Phase 6 — Confirm

Present summary:

```
## PR Feedback — PR #<number>

### Fixed ({N})
- **@reviewer:** "<comment>" → Fix: <what changed> → Reply: "<draft>"

### Disagreed ({N})
- **@reviewer:** "<comment>" → Reason: <why the code is right> → Reply: "<draft>"

### Deferred ({N})
- **@reviewer:** "<comment>" → Why it's out of scope: <reason> → Reply: "<draft>"
```

Unless `--yolo`, ask: "Push commits and post replies? (yes / adjust / abort)"

- **yes** → Phase 7
- **adjust** → user specifies changes, re-present
- **abort** → stop, local commits remain

## Phase 7 — Push and respond

Re-check PR state immediately before pushing — it may have closed or merged since Phase 1:

```bash
gh pr view <PR_NUMBER> --json state
```

If not `OPEN`, stop: "PR #<n> is <state>. Not pushing. Local commits remain on `HEAD_BRANCH`."

```bash
git push origin <HEAD_BRANCH>
```

Post replies using the correct endpoint per comment type:

```bash
# Inline review comments — reply in the review thread
gh api repos/{owner}/{repo}/pulls/{PR_NUMBER}/comments/{comment_id}/replies \
  --method POST -f body="<reply>"

# Conversation comments — reply in the issue thread
gh api repos/{owner}/{repo}/issues/{PR_NUMBER}/comments \
  --method POST -f body="<reply>"
```

Clean up any worktree. Report: comments addressed, PR link, any failures.
