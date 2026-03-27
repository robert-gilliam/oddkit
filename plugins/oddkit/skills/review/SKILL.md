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

#### Confirm before posting

Unless `--yolo`:
- Show number of findings, severity breakdown, summary table
- Ask: "Post this review to PR #{PR_NUMBER}? (y/n)"
- If declined, show findings locally and stop

#### Post findings

**Default: use `mcp__github_inline_comment__create_inline_comment` if available.**

For each finding, post an inline comment using the MCP tool with `confirmed: true`. Format:

```
**{SEVERITY}** — [{Agent}]

{Issue}

**Why:** {Explanation}
```

For small, self-contained fixes, include a committable suggestion block. For larger fixes (6+ lines, structural changes, multi-file), describe the fix without a suggestion block.

Post one comment per unique issue. Do not post duplicates.

**Fallback: `gh pr comment` with code links.**

If the MCP inline comment tool is not available, post a single comment on the PR:

```bash
gh pr comment <PR_NUMBER> --body "<review body>"
```

Format the body with linked code references. Use full SHA links so GitHub renders syntax-highlighted code previews:

```
## Automated Review

**{N} issue(s) found** ({B} blocking, {W} warnings)

*Reviewed by: {agent names}*

---

### 1. {SEVERITY} — {Issue title}

[{file}:{line}](https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{file}#L{start}-L{end})

{Issue description}

**Why:** {Explanation}

---

(repeat for each finding)

*{count} finding(s) removed during verification.*
```

Link format must be exact — full SHA, `#L{start}-L{end}` with at least 1 line of context above and below:

```
https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{path}#L{start}-L{end}
```

Report: issues found, discarded count, PR link.

## Step 5 — Clean up

Remove any temporary worktree created in Step 1.
