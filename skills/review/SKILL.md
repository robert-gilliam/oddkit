---
name: review
description: >
  Review code or plans. No args = local self-review. PR number = GitHub review with confirmation.
  Use when the user wants to review a PR, self-review before pushing, or says /oddkit:review.
argument-hint: "[#PR or branch] [--yolo]"
---

# Review

Review changes using parallel subagents. Auto-detects code vs plan content and picks the right agents.

## Parse arguments

Extract from `$ARGUMENTS`:
- **PR reference**: `#\d+`, `/pull/\d+`, GitHub URL, or branch name
- **`--yolo`**: skip confirmation, post directly

No args = local review (terminal only, no GitHub).

## Step 1 — Resolve target and get the diff

### If PR reference provided

```bash
gh pr view <ref> --json number,title,body,headRefName,headRefOid,baseRefName
gh repo view --json owner,name
```

Store `PR_NUMBER`, `PR_BODY`, `HEAD_SHA`, `OWNER`, `REPO`, `TARGET_REF`, `BASE_REF`.

If no PR found, stop: "No open PR found. Push your branch and open a PR first."

### If no args (local review)

```bash
TARGET_REF=HEAD
BASE_REF=main
git fetch origin main
git update-ref refs/heads/main refs/remotes/origin/main
```

### Get the diff

If `TARGET_REF` is not the current branch, fetch it and create a temporary worktree:

```bash
git fetch origin <TARGET_REF>
git worktree add .review-<timestamp> origin/<TARGET_REF> --detach
```

```bash
git diff <BASE_REF>...<diff_target>
git diff <BASE_REF>...<diff_target> --stat
```

If diff is empty, stop: "No changes found. Nothing to review."

If diff exceeds 5,000 lines, warn and ask to confirm.

## Step 2 — Detect content type and spawn agents

Examine the diff to determine content type:

- **Code**: diff contains source files (.ts, .js, .py, .go, .rs, etc.)
- **Plan/docs**: diff contains only markdown, text, or documentation files

If mixed, treat as code review (code agents catch what matters most).

### Code review → 3 agents in parallel

Spawn `@oddkit:bug-hunter`, `@oddkit:ship-blocker`, `@oddkit:dx-critic` using the Agent tool.

Pass each agent the full diff and PR description (if available). Each must quote exact code snippets from the diff for every finding.

### Plan review → 4 agents in parallel

Spawn `@oddkit:fact-checker`, `@oddkit:architecture-critic`, `@oddkit:completeness-auditor`, `@oddkit:simplicity-auditor`.

For fact-checker, also read full file contents (not just diff hunks) so it can verify claims against the codebase. Pass all agents the diff and PR description.

Each must quote exact text from the plan for every finding.

## Step 3 — Collect, deduplicate, verify

### 3a. Parse and deduplicate

Parse structured output from each agent. Skip any that returned "No issues found."

If multiple agents flagged the same snippet for the same root cause, merge into one finding. Keep highest severity. Note which agents flagged it.

### 3b. Verify every finding

For EVERY finding:

1. Read the file at the reported path
2. Search for the quoted SNIPPET to find the actual line number
3. Check at least 20 lines of surrounding context
4. Trace code paths (callers, callees, types) as needed
5. Ask: does this issue actually exist, or did the agent misunderstand?

**Discard** if:
- Snippet doesn't exist in the file (hallucinated)
- Issue doesn't exist in the actual code
- Issue is handled elsewhere (null check upstream, etc.)
- Concern is theoretical / code path can't be triggered

For plan review findings, also apply:
- Would this cause an agent to build the wrong thing or get stuck?
- Would acting on this suggestion add complexity? If so, reframe toward simpler.
- Discard prose quality nits, "worth discussing" items, and equally-valid alternatives.

### 3c. Consolidate

If >10 findings for one file, group related ones into block comments.

## Step 4 — Output results

### Local review (no PR reference)

Print to terminal:

```
## Review — {N} issue(s) found

{DIFF_STAT}

### BLOCKING ({count})

**{file}:{line}** — [{Agent(s)}]
{Issue description}

> {code snippet}

**Why:** {Explanation}

---

### WARNINGS ({count})

(same format)

---

*{count} finding(s) removed during verification.*
```

If no findings: "No issues found. All clear."

Done. No GitHub interaction.

### GitHub review (PR reference provided)

#### Compute diff positions

For each finding, compute the GitHub diff `position` (not file line number):

1. Find the file's diff section
2. Find the hunk containing the target line (`@@ -old,count +new,count @@`)
3. Count every line from the first `@@` header (position 1). Positions are cumulative across hunks.
4. Track new-file line number from hunk's `+new` value. Context (` `) and additions (`+`) increment. Deletions (`-`) don't.
5. When new-file line matches target, that's the position.

If target line isn't in any hunk, include in review body instead.

#### Build review payload

```json
{
  "commit_id": "{HEAD_SHA}",
  "body": "{summary}",
  "event": "{BLOCKING → REQUEST_CHANGES | WARNING only → COMMENT | none → APPROVE}",
  "comments": [{ "path": "...", "position": N, "body": "..." }]
}
```

Summary table format:

```
## Automated Review

**{N} issue(s) found** ({B} blocking, {W} warnings)

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | BLOCKING | `file:line` | Description |

*Reviewed by: {agent names}*
```

Inline comment format (keep tight):

```
**{SEVERITY}** — [{Agent}]

{Issue}

**Why:** {Explanation}
```

#### Confirm and post

Unless `--yolo`:
- Show review event type, number of comments, summary table
- Ask: "Post this review to PR #{PR_NUMBER}? (y/n)"
- If declined, show findings locally and stop

Post via:

```bash
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/reviews --method POST --input /tmp/review-payload.json
```

Report: issues found, discarded count, review event, PR link.

## Step 5 — Clean up

Remove any temporary worktree created in Step 1.
