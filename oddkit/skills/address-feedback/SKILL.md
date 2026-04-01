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
- **`--yolo`**: push and post without confirmation

## Phase 1 — Identify the PR

```bash
gh pr view <ref or current branch> --json number,title,body,headRefName,baseRefName,url
```

Store `PR_NUMBER`, `HEAD_BRANCH`, `BASE_BRANCH`, `PR_URL`.

If no PR found, stop: "No open PR found. Specify a PR number or switch to a branch with an open PR."

Verify local branch is up-to-date with origin. If not, stop: "Local branch is not up-to-date with origin. Pull or push first."

## Phase 2 — Set up workspace

If already on `HEAD_BRANCH`, use current directory. Otherwise create a worktree.

Fetch the base branch for comparison.

Store `WORK_DIR` for all subsequent file operations.

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

Merge all three into a single list. Filter to actionable, unresolved comments. For each, store: `comment_id`, `comment_type` (inline, review, conversation), `path` (if inline), `line` (if inline), `body`, `diff_hunk` (if inline), `user.login`.

Group inline comments by file. Conversation and review-body comments form a separate "general" group.

## Phase 4 — Evaluate each comment

For each comment:

### 4a. Read the actual code

Read the file at the comment's path. At least 30 lines of context. Trace related code paths if needed.

### 4b. Evaluate critically

- Is the comment valid? Does the issue exist?
- Is the reviewer's understanding correct? If the code is right, explain why.
- Is there a real problem, but different from what the reviewer described? Fix the real one.

### 4c. Categorize

| Category | Criteria | Action |
|----------|----------|--------|
| Simple fix | Clear issue, straightforward, low regression risk | Fix it |
| Complex/risky | Real issue, but multi-file or behavior change | Flag to user first |
| Disagree | Misunderstanding or code is correct | Draft explanation |
| Unclear | Can't determine intent or right fix | Ask user |

Bias toward simple, obvious fixes. If two approaches work, pick the obvious one. If fix touches >2-3 files or changes public interfaces, it's complex/risky.

Present complex/risky and unclear items to user before proceeding.

## Phase 5 — Implement fixes

For each simple fix:
1. Make the change in `WORK_DIR`
2. Verify fix in context
3. Stage and commit: `Address review: <brief description>`
4. Draft reply (brief: "Fixed — good catch." or similar)

For disagree items: draft respectful explanation referencing actual code behavior.

Group commits when multiple comments share a root cause.

## Phase 6 — Confirm

Present summary:

```
## PR Feedback — PR #<number>

### Fixes ({N})
- **@reviewer:** "<comment>" → Fix: <what changed> → Reply: "<draft>"

### Pushed back ({N})
- **@reviewer:** "<comment>" → Reason: <why> → Reply: "<draft>"

### Deferred ({N})
- **@reviewer:** "<comment>" → Why: <risk>

### Needs input ({N})
- **@reviewer:** "<comment>" → Question: <what you need>
```

Unless `--yolo`, ask: "Push commits and post replies? (yes / adjust / abort)"

- **yes** → Phase 7
- **adjust** → user specifies changes, re-present
- **abort** → stop, local commits remain

## Phase 7 — Push and respond

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
