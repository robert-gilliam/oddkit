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

Get GitHub's canonical diff — this is the authoritative source for what's in the PR.
Write it straight to disk so it never enters your context; agents Read it from the file:

```bash
mkdir -p .oddkit/review
gh pr diff <PR_NUMBER> > .oddkit/review/diff-<PR_NUMBER>-<timestamp>.txt
gh pr diff <PR_NUMBER> --name-only
```

Use the same `<timestamp>` as the worktree below so concurrent reviews don't collide.
Store the diff file's absolute path as `DIFF_FILE` and the file list as `PR_FILES`.

Use the diff at `DIFF_FILE` for all analysis. Do NOT use `git diff` for GitHub reviews — local diffs can diverge from what GitHub considers part of the PR.

Create a worktree at the PR's head commit so agents search the code as it exists in the PR, not whatever branch you happen to have checked out:

```bash
mkdir -p .oddkit/worktrees
git fetch origin <HEAD_SHA>
git worktree add .oddkit/worktrees/review-<timestamp> <HEAD_SHA> --detach
```

Store the worktree path as `REVIEW_ROOT`. All codebase reads (agent searches, verification) must use paths relative to `REVIEW_ROOT`.

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
mkdir -p .oddkit/worktrees
git fetch origin <TARGET_REF>
git worktree add .oddkit/worktrees/review-<timestamp> origin/<TARGET_REF> --detach
```

```bash
mkdir -p .oddkit/review
git diff <BASE_REF>...<diff_target> > .oddkit/review/diff-local-<timestamp>.txt
git diff <BASE_REF>...<diff_target> --stat
```

Store the diff file's absolute path as `DIFF_FILE`.

If the diff file is empty, stop: "No changes found. Nothing to review."

If the diff exceeds 5,000 lines (`wc -l < "$DIFF_FILE"`), warn and ask to confirm.

## Step 2 — Detect content type and spawn agents

### Detect content type

**If file path (no diff)** — from the file extension:
- **Code** (.ts, .js, .py, .go, .rs, etc.) → code review agents
- **Plan/docs** (.md, .txt) → plan review agents

**If diff** — from the changed file list (`PR_FILES` for GitHub reviews, the `--stat`
output for local ones), no need to read the diff itself:
- **Code**: diff contains source files (.ts, .js, .py, .go, .rs, etc.)
- **Plan/docs**: diff contains only markdown, text, or documentation files

If mixed, treat as code review (code agents catch what matters most).

Then pick a path below. Both handle either case.

### Workflow path (preferred)

If the Workflow tool is in your tool list, use it instead of spawning agents by hand.
The script runs the right agents for the content type, dedupes exact-duplicate findings,
and verifies every survivor with a throwaway sonnet agent — so the file reads that
verification needs never land in your context. Invoke:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/scripts/review.workflow.js`
- `args`: `mode` (`"code"` or `"plan"` from the detection above), plus whichever of
  these this review has: `diff_file` (abs `DIFF_FILE`), `file_path` (abs `FILE_PATH`,
  no-diff mode), `review_root` (abs `REVIEW_ROOT`, GitHub reviews), `pr_files`
  (`PR_FILES` array, GitHub reviews), `pr_body` (`PR_BODY`).

The result is `{ findings, discarded, unverified, agents_failed }`. Findings arrive
deduplicated and verified, each carrying `severity`, `why`, `line`, and the `agents`
that flagged it. Three things the caller must honor:

- **`line: 0` means no diff anchor** (a finding about absent code, or a file-level
  claim). Post those in the review body — GitHub rejects line 0 with a 422 after the
  pending review is already open, and the `gh` fallback builds a broken `#L0` link.
- **`agents_failed`** names reviewers that died. A whole perspective is missing, so
  report it and apply the 3d rule below.
- **`unverified`** counts findings no verifier reached. These are coverage gaps, not
  discards — never fold them into the "removed during verification" count.

Skip the manual spawn below and Steps 3a–3b; resume at Step 3c with these findings.

### Manual path (Workflow tool unavailable)

Spawn the agents yourself as described below, then run all of Step 3. For a single-file
review, pass `FILE_CONTENT` to the agents instead of a diff.

### Code review → 3 agents in parallel

Spawn `@oddkit:correctness`, `@oddkit:intent-checker`, `@oddkit:design-critic` using the Agent tool.

**All three agents** get:
- The diff file path (`DIFF_FILE`), with this instruction: "Read the full unified diff
  at <abs DIFF_FILE> before doing anything else. It is the change under review."
- **For GitHub reviews:** the file list (`PR_FILES`) with this instruction: "Only report findings in these files. These are the files in the PR diff."
- **For GitHub reviews:** "Search the codebase at `REVIEW_ROOT` (not the repo root) for all file reads, globs, and greps — except the diff file at <abs DIFF_FILE>."

**correctness** also gets:
- No PR description. It reviews the code mechanically — what breaks, what leaks, what's unsafe.

**intent-checker** also gets:
- PR description (required — this agent compares intent vs. reality)
- This framing: "Compare what the PR says it does against what the code actually does. Flag mismatches, unstated changes, and incomplete coverage of stated goals."

**design-critic** also gets:
- PR description (if available)
- This framing: "You're reviewing a code change. Here's the diff and the PR description. Search the codebase for existing patterns that could simplify or replace this approach."

Each agent must quote exact code snippets from the diff for every finding.

### Plan review → 3 agents in parallel

Spawn `@oddkit:fact-checker`, `@oddkit:completeness-auditor`, `@oddkit:design-critic`.

**fact-checker and completeness-auditor** get:
- The diff file path (`DIFF_FILE`), with the same read-first instruction
- PR description (if available)
- **For GitHub reviews:** the file list with the same scoping instruction
- **For GitHub reviews:** "Search the codebase at `REVIEW_ROOT` (not the repo root) for all file reads, globs, and greps — except the diff file at <abs DIFF_FILE>."

For fact-checker, also read full file contents (not just diff hunks) so it can verify claims against the codebase.

**design-critic** gets:
- The diff file path (`DIFF_FILE`), with the same read-first instruction
- PR description (if available)
- **For GitHub reviews:** the file list with the same scoping instruction
- **For GitHub reviews:** "Search the codebase at `REVIEW_ROOT` (not the repo root) for all file reads, globs, and greps — except the diff file at <abs DIFF_FILE>."
- This framing: "You're reviewing an implementation plan. Here's the plan text. Evaluate whether the proposed design is sound, appropriately scoped, and as simple as it can be. Search the codebase for existing patterns that the plan could leverage."

Each agent must quote exact text from the plan for every finding.

## Step 3 — Collect, deduplicate, verify

Workflow path: findings arrive deduplicated and verified — skip 3a and 3b, start at 3c.

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
1. Read the file at the reported path (use `REVIEW_ROOT` for GitHub reviews)
2. Search for the quoted SNIPPET to find the actual line number
3. Check at least 20 lines of surrounding context
4. Trace code paths (callers, callees, types) as needed (use `REVIEW_ROOT` for GitHub reviews)
5. Ask: does this issue actually exist, or did the agent misunderstand?

Where verification needs the diff itself (confirming a hunk is part of the change), read
`DIFF_FILE` — don't refetch it.

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

### 3d. Recommend

Pick one verdict from the findings:
- **Ready to merge** — no blocking issues
- **Fix then merge** — blocking issues are small, localized fixes
- **Needs reworking** — blocking issues require structural or design changes

**Never say "Ready to merge" on an incomplete pass.** If any reviewer died
(`agents_failed`) or any finding went unverified (`unverified`), the review didn't
cover what it claims to. Use "Fix then merge" at most, and name the gap in the review
body: "review incomplete — {agent} failed" / "{n} finding(s) unverified".

Store as `VERDICT`. Map to the GitHub review event:
- Ready to merge / Fix then merge → `"APPROVE"`
- Needs reworking → `"COMMENT"`

Store as `REVIEW_EVENT`.

**Self-authored PRs can't be approved.** GitHub rejects an APPROVE review from the PR's
own author (422), and PRs opened by this pipeline share the reviewer's `gh` account.
Before posting, compare authors:

```bash
gh pr view <PR_NUMBER> --json author --jq .author.login
gh api user --jq .login
```

If they match and `REVIEW_EVENT` is `"APPROVE"`, downgrade it to `"COMMENT"` — the
verdict still leads the review body, so no signal is lost.

## Step 4 — Output results

### File review or local review (no PR reference)

Print to terminal. For file reviews, replace `{DIFF_STAT}` with `Reviewing: {FILE_PATH}`.

```
## Review — {N} issue(s) found

{DIFF_STAT or file path}

**Recommendation:** {VERDICT}.

### BLOCKING ({count})

**{file}:{line}** — [{Agent(s)}]
{Issue description}

> {code snippet}

**Why:** {Explanation}

---

### WARNINGS ({count})

(same format)

---

*{discarded} finding(s) removed during verification.*
{If agents_failed or unverified: *Review incomplete: {agents_failed} agent(s) failed, {unverified} finding(s) unverified.*}
```

Findings with `line: 0` print under their file as `**{file}** — (no line anchor)`.

If no findings: "No issues found. All clear. **Recommendation:** {VERDICT}."

Done. No GitHub interaction.

### GitHub review (PR reference provided)

#### Confirm before posting

Unless `--yolo`:
- Show number of findings, severity breakdown, summary table, `VERDICT`, and `REVIEW_EVENT`
- Ask: "Post this review to PR #{PR_NUMBER} as {REVIEW_EVENT}? (y/n)"
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

For each finding with a real line number, call
`mcp__plugin_github_github__add_comment_to_pending_review` with:
- `owner`, `repo`, `pullNumber`
- `path`: file path relative to repo root
- `line`: the line number in the diff
- `side`: `"RIGHT"`
- `subjectType`: `"LINE"`
- `body`: the comment (format below)

**Findings with `line: 0` have no diff anchor** — code that is absent, or a claim about
the change as a whole. Never pass 0 as `line`: GitHub 422s and the pending review is
already open. Put them in the submit body instead, under an `**Unanchored findings**`
heading, each naming its file when it has one.

For multi-line comments, also pass `startLine` and `startSide: "RIGHT"`.

Comment format:

```
**{SEVERITY}** — [{Agent}]

{Issue}

**Why:** {Explanation}
```

Two sentences max across issue and why. State the problem, then the impact. Don't restate the code, don't hedge, don't preface ("This could potentially...", "It might be worth considering...").

For small, self-contained fixes, include a suggestion block. For larger fixes (6+ lines, structural, multi-file), describe the fix without one.

One comment per unique issue. No duplicates.

**3. Submit the pending review:**

Call `mcp__plugin_github_github__pull_request_review_write` with:
- `method`: `"submit_pending"`
- `owner`: `OWNER`, `repo`: `REPO`, `pullNumber`: `PR_NUMBER`
- `event`: `REVIEW_EVENT`
- `body`: one sentence of praise naming the concrete thing that works (a clean abstraction, good test coverage, edge case handling), followed by `"Recommendation: {VERDICT}."`, followed by the stats line: `"Reviewed: {N} issue(s) — {B} blocking, {W} warnings. {discarded} finding(s) removed during verification."`
  Append the coverage gaps when there are any — `"Review incomplete: {agents_failed} agent(s) failed, {unverified} finding(s) unverified."` A pass that ran two of three
  agents must not read as a clean sweep.

No generic "great work!" — name a specific thing.

**Fallback: `gh pr review` (or `gh pr comment`) with code links.**

If the MCP review tools are not available:

```bash
# If REVIEW_EVENT is APPROVE:
gh pr review <PR_NUMBER> --approve --body "<review body>"
# Otherwise:
gh pr comment <PR_NUMBER> --body "<review body>"
```

Format with linked code references. Use full SHA links (`https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{path}#L{start}-L{end}`) so GitHub renders code previews. Lead with one sentence of praise naming a specific thing that works:

```
{One sentence of specific praise.}

**Recommendation:** {VERDICT}.

**{N} issue(s)** — {B} blocking, {W} warnings

**{SEVERITY}** [{file}:{line}](https://github.com/{OWNER}/{REPO}/blob/{HEAD_SHA}/{file}#L{start}-L{end})
{Issue}
**Why:** {Explanation}

(repeat for each finding)

*{discarded} removed during verification.*
{If agents_failed or unverified: *Review incomplete: {agents_failed} agent(s) failed, {unverified} finding(s) unverified.*}
```

Findings with `line: 0` get no `#L` anchor — link the file alone.

Report: issues found, discarded count, PR link.

## Step 5 — Clean up

Remove the temporary worktree created in Step 1:

```bash
git worktree remove .oddkit/worktrees/review-<timestamp> --force
```