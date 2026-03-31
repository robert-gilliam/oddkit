---
name: review
description: >
  Review code or plans. No args = local self-review. PR number = GitHub review with confirmation.
  Use when the user wants to review a PR, self-review before pushing, or says /oddkit:review.
argument-hint: "[#PR or branch or file path] [--yolo]"
---

# Review

Review changes using parallel subagents. Auto-detects code vs plan content and picks the right agents.

## Parse arguments

Extract from `$ARGUMENTS`:
- **File path**: argument ending in a file extension (`.md`, `.txt`, `.ts`, etc.) or containing `/` without `#` — review a single file directly
- **PR reference**: `#\d+`, `/pull/\d+`, GitHub URL, or branch name
- **`--yolo`**: skip confirmation, post directly

No args = local review (terminal only, no GitHub).
File path = file review (terminal only, no GitHub, no diff).

## Step 1 — Resolve target and get content

### If file path provided

Read the file. If it doesn't exist, stop: "File not found: {path}"

Store the file contents as `FILE_CONTENT` and the path as `FILE_PATH`.

Skip straight to Step 2 — no diff, no git, no GitHub.

### If PR reference provided

```bash
gh pr view <ref> --json number,title,body,headRefName,headRefOid,baseRefName
gh repo view --json owner,name
```

Store `PR_NUMBER`, `PR_BODY`, `HEAD_SHA`, `OWNER`, `REPO`, `TARGET_REF`, `BASE_REF`.

If no PR found, stop: "No open PR found. Push your branch and open a PR first."

Get GitHub's canonical diff — this is the authoritative source for what's in the PR:

```bash
gh pr diff <PR_NUMBER>
gh pr diff <PR_NUMBER> --name-only
```

Store the diff as `PR_DIFF` and the file list as `PR_FILES`.

Use `PR_DIFF` for all analysis. Do NOT use `git diff` for GitHub reviews — local diffs can diverge from what GitHub considers part of the PR.

### If no args (local review)

```bash
TARGET_REF=HEAD
BASE_REF=main
git fetch origin main
git update-ref refs/heads/main refs/remotes/origin/main
```

### Get the diff (local review only)

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

### If file path (no diff)

Determine content type from the file extension:
- **Code** (.ts, .js, .py, .go, .rs, etc.) → code review agents
- **Plan/docs** (.md, .txt) → plan review agents

Pass `FILE_CONTENT` to the agents instead of a diff. Skip to Step 3.

### If diff

Examine the diff to determine content type:

- **Code**: diff contains source files (.ts, .js, .py, .go, .rs, etc.)
- **Plan/docs**: diff contains only markdown, text, or documentation files

If mixed, treat as code review (code agents catch what matters most).

### Code review → 3 agents in parallel

Spawn `@oddkit:bug-hunter`, `@oddkit:ship-blocker`, `@oddkit:dx-critic` using the Agent tool.

Pass each agent:
- The diff (use `PR_DIFF` for GitHub reviews, local diff for local reviews)
- PR description (if available)
- **For GitHub reviews:** the file list (`PR_FILES`) with this instruction: "Only report findings in these files. These are the files in the PR diff."

Each must quote exact code snippets from the diff for every finding.

### Plan review → 4 agents in parallel

Spawn `@oddkit:fact-checker`, `@oddkit:architecture-critic`, `@oddkit:completeness-auditor`, `@oddkit:simplicity-auditor`.

For fact-checker, also read full file contents (not just diff hunks) so it can verify claims against the codebase. Pass all agents the diff, PR description, and for GitHub reviews the file list with the same scoping instruction.

Each must quote exact text from the plan for every finding.

## Step 3 — Collect, deduplicate, verify

### 3a. Parse and deduplicate

Parse structured output from each agent. Skip any that returned "No issues found."

If multiple agents flagged the same snippet for the same root cause, merge into one finding. Keep highest severity. Note which agents flagged it.

### 3b. Verify every finding

For EVERY finding:

**If reviewing a file (no diff):**
1. Search `FILE_CONTENT` for the quoted snippet
2. Check surrounding context in the file
3. For plan reviews: verify claims against the actual codebase (read referenced files, grep for referenced functions/patterns)
4. Ask: does this issue actually exist, or did the agent misunderstand?

**If reviewing a diff:**
1. Read the file at the reported path
2. Search for the quoted SNIPPET to find the actual line number
3. Check at least 20 lines of surrounding context
4. Trace code paths (callers, callees, types) as needed
5. Ask: does this issue actually exist, or did the agent misunderstand?

**Discard** if:
- Snippet doesn't exist in the file or diff (hallucinated)
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

### File review or local review (no PR reference)

Print to terminal. For file reviews, replace `{DIFF_STAT}` with `Reviewing: {FILE_PATH}`.

```
## Review — {N} issue(s) found

{DIFF_STAT or file path}

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

#### Confirm before posting

Unless `--yolo`:
- Show number of findings, severity breakdown, summary table
- Ask: "Post this review to PR #{PR_NUMBER}? (y/n)"
- If declined, show findings locally and stop

#### Post findings

**Default: use GitHub MCP review tools if available.**

**1. Create a pending review:**

Call `mcp__plugin_github_github__pull_request_review_write` with:
- `method`: `"create"`
- `owner`: `OWNER`, `repo`: `REPO`, `pullNumber`: `PR_NUMBER`
- `commitID`: `HEAD_SHA`
- Do NOT pass `event` — omitting it creates a pending review.

**2. Add inline comments to the pending review:**

For each finding, call `mcp__plugin_github_github__add_comment_to_pending_review` with:
- `owner`, `repo`, `pullNumber`
- `path`: file path relative to repo root
- `line`: the line number in the diff
- `side`: `"RIGHT"`
- `subjectType`: `"LINE"`
- `body`: the comment (format below)

For multi-line comments, also pass `startLine` and `startSide: "RIGHT"`.

Comment format:

```
**{SEVERITY}** — [{Agent}]

{Issue}

**Why:** {Explanation}
```

For small, self-contained fixes, include a suggestion block. For larger fixes (6+ lines, structural, multi-file), describe the fix without one.

One comment per unique issue. No duplicates.

**3. Submit the pending review:**

Call `mcp__plugin_github_github__pull_request_review_write` with:
- `method`: `"submit_pending"`
- `owner`: `OWNER`, `repo`: `REPO`, `pullNumber`: `PR_NUMBER`
- `event`: `"COMMENT"`
- `body`: `"Reviewed: {N} issue(s) — {B} blocking, {W} warnings. {count} finding(s) removed during verification."`

**Fallback: `gh pr comment` with code links.**

If the MCP review tools are not available, post a single comment on the PR:

```bash
gh pr comment <PR_NUMBER> --body "<review body>"
```

Format with linked code references. Use full SHA links (`https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{path}#L{start}-L{end}`) so GitHub renders code previews:

```
**{N} issue(s)** — {B} blocking, {W} warnings

**{SEVERITY}** [{file}:{line}](https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{file}#L{start}-L{end})
{Issue}
**Why:** {Explanation}

(repeat for each finding)

*{count} removed during verification.*
```

Report: issues found, discarded count, PR link.

## Step 5 — Clean up

Remove any temporary worktree created in Step 1.