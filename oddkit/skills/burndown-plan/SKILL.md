---
name: burndown-plan
description: >
  Set up an autonomous burndown session for a list of GitHub issues. Creates an isolated
  session worktree, recons every issue in parallel, writes per-issue state, and drops
  clarifying-question files into the editor for the developer to answer offline. Pairs
  with /oddkit:burndown-implement, which runs the work without further intervention. Use
  when the user wants to plan a batch of issues and walk away — "set up a burndown",
  "prep these issues", "draft burndown questions for #X #Y", or
  "/oddkit:burndown-plan". Always pick this over the interactive /oddkit:burndown when
  the developer wants async clarification instead of a realtime Q&A.
argument-hint: "<issue refs...>"
model: sonnet
---

# Burndown — Plan

Half one of the autonomous burndown flow. Set up an isolated session, recon issues,
classify them, and write any clarifying questions to disk. The developer answers in their
editor whenever they want. `/oddkit:burndown-implement` then ships PRs without stopping
to ask anything.

**Why isolate.** State lives in the developer's `.oddkit/` (gitignored, branch-independent).
Recon agents read code from a session worktree pinned to fresh `origin/<base>`, so they see
a known state regardless of what the developer has checked out. Per-issue worktrees branch
off `origin/<base>` at implement time, one PR each. The session is resumable: state on disk
means an interrupted run picks up where it left off.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

**Model strategy.** Orchestrator is sonnet. Pass `model:` explicitly on every Agent call:
- recon (`@oddkit:code-scout`, `@oddkit:impact-scout`) → sonnet

## Parse arguments

From `$ARGUMENTS`:
- **Issue refs** (positional): `#\d+`, bare numbers, or GitHub issue URLs.

If no refs, ask once: "Which issues should I plan? Paste numbers or URLs." Then proceed.
If issue count > 15, warn and ask before continuing.

## Phase 1 — Set up state and session worktree

Run from the developer's current repo:

```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
SESSION_ID=$(date -u +%Y-%m-%d-%H%M)
SESSION_WORKTREE="$MAIN_REPO/.oddkit/worktrees/burndown-$SESSION_ID"
```

Detect base branch:
```bash
BASE_BRANCH=$(git -C "$MAIN_REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
  | sed 's|origin/||')
# Fallback to main, then master.
```

Fetch the latest base. Recon must see what's actually on `origin/<base>`, not whatever the
developer has checked out:
```bash
git -C "$MAIN_REPO" fetch origin "$BASE_BRANCH"
```

Initialize state directories in the **main repo's** `.oddkit/` (gitignored, branch-independent):
```bash
mkdir -p "$MAIN_REPO"/.oddkit/{burndown-sessions,burndown-issue-tracking,burndown-issue-descriptions,burndown-clarifying-questions,burndown-plans,burndown-comments-pending,worktrees}
```

State files always live in `$MAIN_REPO/.oddkit/` — never inside any worktree. The session
worktree is purely a code view for recon.

Collision: if `$SESSION_WORKTREE` already exists, append `-2`, `-3`.

Create the session worktree, detached at fresh `origin/<base>` (read-only intent — recon
agents shouldn't commit here):
```bash
git -C "$MAIN_REPO" worktree add --detach "$SESSION_WORKTREE" "origin/$BASE_BRANCH"
```

Path conventions for everything that follows:
- **State files** — absolute paths under `$MAIN_REPO/.oddkit/`.
- **Recon agents** — pass `$SESSION_WORKTREE` as `cwd` so they read code at `origin/<base>`,
  but tell them to write outputs to absolute paths under `$MAIN_REPO/.oddkit/`.
- **Don't `cd`** — use `cwd:` arguments or `git -C <path>`.

## Phase 2 — Fetch and cache issue descriptions

For each issue:
```bash
gh issue view <n> --json number,title,body,labels,assignees,url,state,comments
```

Skip closed issues with a warning. Scan body+comments for `depends on #N`, `blocked by
#N`, `after #N`, `requires #N` to populate `blocked_by`.

Write the issue body verbatim to:
```
$MAIN_REPO/.oddkit/burndown-issue-descriptions/<n>.md
```

Format: a level-1 heading with the title, a metadata block (URL, labels, assignees,
state), then the body, then a `## Comments` section if non-empty. This is the canonical
copy of the issue — burndown-implement reads from here, not from `gh` (no network at
implement time).

## Phase 3 — Initialize tracking files

For each issue, write `$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>.json`:

```json
{
  "issue_number": 123,
  "title": "Add CSV export",
  "url": "https://github.com/owner/repo/issues/123",
  "labels": ["enhancement"],
  "session_id": "2026-04-30-1430",
  "phase": "pending",
  "complexity": null,
  "rationale": null,
  "blocked_by": [],
  "needs_clarifications": null,
  "clarifications_file": null,
  "evidence": [],
  "recon_summary": null,
  "worktree": null,
  "branch": null,
  "base_branch": "main",
  "plan_file": null,
  "implementation_complete": false,
  "pushed_to_github": false,
  "pr_url": null,
  "comment_posted": false,
  "comment_error": null,
  "failure_reason": null,
  "tests_status": null,
  "plan_compliance": null,
  "summary": null,
  "caveats": null,
  "updated_at": "<iso utc>"
}
```

Phases (state machine):
- `pending` — registered
- `reconned` — recon done
- `classified` — complexity decided
- `awaiting_clarifications` — clarifying-questions file written, not yet answered
- `ready` — answered (or no questions needed); ready to implement
- `implementing` — impl agent running
- `implementation_complete` — code/tests done locally; not yet pushed
- `done` — pushed, PR opened, comment posted
- `failed` — impl gave up after retry
- `blocked` — predecessor in chain failed
- `already_done` — recon found existing impl; no PR

The two booleans `implementation_complete` and `pushed_to_github` are explicit shortcuts
on top of `phase` so the developer can grep state at a glance. Update both when the
matching transition happens.

Write the file immediately and rewrite it after every state change. Use a small atomic
write (`mv tmp final`) to avoid half-written JSON on crash.

## Phase 4 — Recon all issues in parallel

For each issue, spawn `@oddkit:code-scout` and `@oddkit:impact-scout` via the Agent tool —
**`model: sonnet` on every call**. Pass the issue title and body. Tell each agent to:
- Read code from `$SESSION_WORKTREE` (pass it as `cwd`) so they see fresh `origin/<base>`.
- Write any output files to absolute paths under `$MAIN_REPO/.oddkit/`.

Run all `2 * len(issues)` calls in one message.

When agents return, write a 2-3 line `recon_summary` into each tracking file: where the
work lands, what pattern to follow. Save full recon output as
`$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>-recon.md` for reference at implement time.
Set `phase = "reconned"`.

## Phase 5 — Classify and detect file overlap

### Classify (you, inline)

For each issue, decide from issue text + recon:

- **already_done**: behavior already exists. No PR, no questions. Record `evidence`:
  1-3 file:line refs from recon. Be conservative — partial coverage stays `simple` or
  `complex` with a note.
- **simple**: one or two files, clear behavior, recon gives a direct template.
- **complex**: multi-file, branching design, ambiguous logic, or wide blast radius.
  Needs a written plan at implement time.

Write `complexity` and one-line `rationale` to each tracking file.

### Detect file overlap

Build `file_path -> [issue_numbers]` from recon "Relevant Files" / "Dependencies". Files
touched by 2+ issues form a serialized chain (stacked PRs). Order = input order unless
recon shows a real dependency. Record `blocked_by` on affected issues.

Set `phase = "classified"` on each issue.

## Phase 6 — Write clarifying-questions files (one per issue that needs them)

This is the whole point. One file per issue, multiple choice, `[Answer]:` after each
question. The developer fills them in offline.

### Decide whether an issue needs questions

Skip when recon + issue body fully define the work. Sharper questions beat blanket
coverage. Ask only when:
- Ambiguous business logic
- Branching design (pattern A vs B, both plausible)
- Scope uncertainty (does X include Y?)
- Unresolved edge cases

`already_done` issues: no questions. The evidence is in the tracking file and the index;
the developer can sanity-check before running implement.

`simple` issues with clear acceptance criteria: usually no questions.

Cap 3-5 questions per issue when needed.

### File path

```
$MAIN_REPO/.oddkit/burndown-clarifying-questions/<n>-<session-id>.md
```

Example: `.oddkit/burndown-clarifying-questions/456-2026-04-30-1430.md`

Issue number first so directory listings group by issue. Timestamp suffix in case the
session is re-run for the same issue later.

### File template

ALWAYS use this exact structure. Implement parses it.

```markdown
---
issue_number: 456
session_id: 2026-04-30-1430
created_at: <iso utc>
status: awaiting_answers
---

# Clarifications — Issue #456

**Title:** <issue title>
**URL:** <issue url>

## Recon summary

<2-3 line recon summary: where the work lands, what pattern to follow, what's ambiguous.>

## How to answer

For each question, write your choice on the `[Answer]:` line. Letter (`A`), option text,
or free-form prose all work.

**All questions must be answered.** Implement skips any issue with blank answers and
alerts you in the final report. If you genuinely don't have a preference, write
`agent's call` and the impl agent will pick the most reasonable option and note it in
the PR body.

---

### Q1: <question>
- A) <option>
- B) <option>
- C) <option>

[Answer]:

### Q2: <question>
- A) <option>
- B) <option>

[Answer]:
```

After writing, set on the issue's tracking file:
- `needs_clarifications: true`
- `clarifications_file: ".oddkit/burndown-clarifying-questions/<n>-<session-id>.md"` (relative to main repo)
- `phase: "awaiting_clarifications"`

For issues without clarifications:
- `needs_clarifications: false`
- `clarifications_file: null`
- `phase: "ready"` (already_done issues stay `already_done`)

## Phase 7 — Write the session index

Path: `$MAIN_REPO/.oddkit/burndown-sessions/<session-id>.md`

All `tracking`/`description`/`clarifications` paths in the frontmatter are relative to
`$MAIN_REPO`.

```markdown
---
session_id: 2026-04-30-1430
created_at: <iso utc>
main_repo: <absolute path>
session_worktree: <absolute path>          # detached at origin/<base>, recon view only
base_branch: main
status: awaiting_answers
issues:
  - number: 123
    tracking: .oddkit/burndown-issue-tracking/123.json
    description: .oddkit/burndown-issue-descriptions/123.md
    clarifications: .oddkit/burndown-clarifying-questions/123-2026-04-30-1430.md
  - number: 456
    tracking: .oddkit/burndown-issue-tracking/456.json
    description: .oddkit/burndown-issue-descriptions/456.md
    clarifications: null
---

# Burndown session — <YYYY-MM-DD HH:mm UTC>

Issues: #123, #456, #789

| # | Title | Class | Clarifications | Implementation | Pushed |
|---|---|---|---|---|---|
| 123 | Add CSV export | complex | needed → file | pending | no |
| 456 | Refactor X | simple | n/a | pending | no |
| 789 | Stub Y | already_done | n/a | n/a (skip) | no |

## Already complete

- **#789** — recon found existing impl at `src/y.ts:42`. Implement will post an evidence
  comment, no PR. If this looks wrong, edit the issue's tracking file
  (`complexity` → `simple` or `complex`) before running implement.

## Serialized chains

- **#123 → #456** — share `src/exporter.ts`. #456 stacks on #123's branch.

## Next steps

1. Open the **clarifying-questions** files for issues that need them (see table).
2. Answer every question. Blank answers cause that issue to be skipped.
3. Run `/oddkit:burndown-implement`. It auto-finds this session and runs unattended.

State lives in `.oddkit/` (gitignored). Session worktree at:

    <absolute path>
```

Set `status` in frontmatter to `awaiting_answers`. Implement updates this to `in_progress`
and finally `complete`.

## Phase 8 — Hand off

Print to the developer:

```
## Burndown plan ready

Session: <session-id>
Session worktree: <absolute path>
State: <main-repo>/.oddkit/

### Cohort
- Already complete: {P}
- Simple: {S}
- Complex: {C}
- Serialized chain: {K}

### Files to fill in
- .oddkit/burndown-clarifying-questions/123-<session-id>.md
- .oddkit/burndown-clarifying-questions/456-<session-id>.md
(or: "No clarifications needed — run /oddkit:burndown-implement when ready.")

### Next step
Run /oddkit:burndown-implement. It will find this session automatically and run
unattended. Resumable: re-invoke any time after interruption.
```

Stop. Don't start implementation.

## Notes for the implementer

- **State lives in `$MAIN_REPO/.oddkit/`** — tracking, descriptions, clarifications, plans,
  session index. Always absolute paths in agent prompts. The session worktree is only a
  read-only code view for recon; never write state into it.
- Use `cwd:` / `git -C <path>` instead of `cd` in compound shell commands.
- Each tracking file is the source of truth for that issue. The index is a human-readable
  summary that points at tracking files; never put authoritative state only in the index.
- Write tracking files atomically (write to `.tmp`, then `mv`). Resumability depends on
  state on disk being consistent at every interrupt point.
- One issue's failure must never block another's progress. Independence is enforced by
  per-issue tracking files and per-issue worktrees at implement time.
- If the developer re-runs `/oddkit:burndown-plan` on the same issues, a brand new
  session worktree and session id are created. The previous session's state stays in
  `.oddkit/` for resume or audit.
