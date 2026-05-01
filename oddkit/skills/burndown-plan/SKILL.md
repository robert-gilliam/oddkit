---
name: burndown-plan
description: >
  Plan a batch of GitHub issues for autonomous implementation. Recons every issue in
  parallel, classifies complexity, and drops clarifying-question files into the editor
  for the developer to answer offline. Pairs with /oddkit:burndown-implement, which ships
  any planned issue whose questions have been answered (or didn't need any). Use when the
  developer wants to prep a batch of issues and walk away — "set up a burndown", "prep
  these issues", "draft burndown questions for #X #Y", or "/oddkit:burndown-plan". Always
  pick this over the interactive /oddkit:burndown when async clarification beats a
  realtime Q&A.
argument-hint: "<issue refs...>"
model: sonnet
---

# Burndown — Plan

Half one of the autonomous burndown flow. Recon a batch of issues, classify them, and
write any clarifying-questions files to disk. The developer answers in their editor
whenever they want. `/oddkit:burndown-implement` ships any issue whose answers are filled
in (or that didn't need any).

**Why isolate.** State lives in the developer's `.oddkit/` (gitignored, branch-
independent). Recon reads from a temporary worktree pinned to fresh `origin/<base>`, so
it sees a known state regardless of what the developer has checked out. The recon
worktree is deleted at the end of this run; per-issue worktrees are created later by
implement.

**One source of truth.** Per-issue state lives in `.oddkit/burndown-issue-tracking/<n>.json`.
The `phase` field is canonical — no parallel boolean flags, no separate status field on
the clarifications file. Implement scans these tracking files directly; there's no
session index to coordinate.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`. Applies to you and every subagent.

**Model strategy.** Orchestrator is sonnet. Pass `model:` explicitly on every Agent call:
- recon (`@oddkit:code-scout`, `@oddkit:impact-scout`) → sonnet

## Parse arguments

From `$ARGUMENTS`:
- **Issue refs** (positional): `#\d+`, bare numbers, or GitHub issue URLs.

If no refs, ask once: "Which issues should I plan? Paste numbers or URLs." Then proceed.
If issue count > 15, warn and ask before continuing.

## Phase 1 — Detect base, set up state, skip already-planned

Run from the developer's current repo:

```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
RUN_ID=$(date -u +%Y-%m-%d-%H%M)
RECON_WORKTREE="$MAIN_REPO/.oddkit/worktrees/burndown-recon-$RUN_ID"
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
mkdir -p "$MAIN_REPO"/.oddkit/{burndown-issue-tracking,burndown-issue-descriptions,burndown-clarifying-questions,burndown-archive-clarifying-questions,burndown-plans,burndown-comments-pending,worktrees}
```

State files always live in `$MAIN_REPO/.oddkit/` — never inside any worktree. The recon
worktree is purely a code view for parallel recon and is deleted at the end of this run.

### Skip already-planned issues

For each issue ref, check whether `$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>.json`
already exists. If it does, drop that issue from this run and remember it for the
handoff. Do not re-recon, do not overwrite, do not regenerate clarifications. The reason
to skip rather than refresh: the developer may have already answered questions, and
overwriting would erase that work.

Tell the developer in the handoff:
> Issue #N is already planned (phase: <phase>). Run /oddkit:burndown-implement to ship,
> or delete `.oddkit/burndown-issue-tracking/<n>.json` (and the matching file under
> `.oddkit/burndown-clarifying-questions/`, if it's still there) to re-plan. Implement
> archives shipped clarifications to `.oddkit/burndown-archive-clarifying-questions/`,
> so for already-shipped issues only the tracking JSON needs to go.

If every supplied issue is already planned, print the handoff and stop — no recon
worktree needed.

### Recon worktree

Create the recon worktree detached at fresh `origin/<base>`. Recon agents read here but
must not commit:
```bash
git -C "$MAIN_REPO" worktree add --detach "$RECON_WORKTREE" "origin/$BASE_BRANCH"
```

Collision: if `$RECON_WORKTREE` already exists, append `-2`, `-3`.

Path conventions for everything that follows:
- **State files** — absolute paths under `$MAIN_REPO/.oddkit/`.
- **Recon agents** — pass `$RECON_WORKTREE` as `cwd` so they read code at `origin/<base>`,
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
  "phase": "pending",
  "complexity": null,
  "rationale": null,
  "blocked_by": [],
  "clarifications_file": null,
  "evidence": [],
  "recon_summary": null,
  "worktree": null,
  "branch": null,
  "base_branch": "main",
  "plan_file": null,
  "pr_url": null,
  "comment_error": null,
  "failure_reason": null,
  "tests_status": null,
  "plan_compliance": null,
  "summary": null,
  "caveats": null,
  "created_at": "<iso utc>",
  "updated_at": "<iso utc>"
}
```

Phases (state machine):
- `pending` — registered, recon not yet done
- `reconned` — recon done and complexity classified
- `awaiting_clarifications` — clarifying-questions file written, answers not yet filled in
- `ready` — answers complete (or no questions needed); ready to implement
- `implementing` — impl agent running
- `implementation_complete` — code+tests done locally; push or PR open failed (resume target)
- `done` — pushed, PR opened, comment posted
- `failed` — impl gave up after retry
- `blocked` — predecessor in chain failed
- `already_done` — recon found existing impl; no PR

`phase` is the single canonical state field. Don't add parallel booleans for it; derive
from `phase` and the explicit result fields (`pr_url`, `clarifications_file`,
`comment_error`).

Write the file immediately and rewrite it after every state change. Use a small atomic
write (`mv tmp final`) to avoid half-written JSON on crash.

## Phase 4 — Recon all issues in parallel

For each issue, spawn `@oddkit:code-scout` and `@oddkit:impact-scout` via the Agent tool —
**`model: sonnet` on every call**. Pass the issue title and body. Tell each agent to:
- Read code from `$RECON_WORKTREE` (pass it as `cwd`) so they see fresh `origin/<base>`.
- Write any output files to absolute paths under `$MAIN_REPO/.oddkit/`.

Run all `2 * len(issues)` calls in one message.

When agents return, write a 2-3 line `recon_summary` into each tracking file: where the
work lands, what pattern to follow. Save full recon output as
`$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>-recon.md` for reference at implement time.

## Phase 5 — Classify and detect file overlap

### Classify (you, inline)

For each issue, decide from issue text + recon:

- **already_done**: behavior already exists. No PR, no questions. Record `evidence`:
  1-3 file:line refs from recon. Be conservative — partial coverage stays `simple` or
  `complex` with a note.
- **simple**: one or two files, clear behavior, recon gives a direct template.
- **complex**: multi-file, branching design, ambiguous logic, or wide blast radius.
  Needs a written plan at implement time.

Write `complexity` and one-line `rationale` to each tracking file. Set
`phase = "reconned"` (already_done issues will be flipped to `phase = "already_done"` in
Phase 6).

### Detect file overlap

Build `file_path -> [issue_numbers]` from recon "Relevant Files" / "Dependencies". Files
touched by 2+ issues form a serialized chain (stacked PRs). Order = input order unless
recon shows a real dependency. Record `blocked_by` on affected issues.

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

`already_done` issues: no questions. The evidence is in the tracking file and the
handoff summary; the developer can sanity-check before running implement.

`simple` issues with clear acceptance criteria: usually no questions.

Cap 3-5 questions per issue when needed.

### File path

```
$MAIN_REPO/.oddkit/burndown-clarifying-questions/<n>.md
```

Example: `.oddkit/burndown-clarifying-questions/456.md`

One file per issue. If the developer wants to re-plan an issue they already answered,
they delete this file and the matching tracking JSON, then re-run plan.

### File template

ALWAYS use this exact structure. Implement parses it.

For the **Issue summary** section, read the cached body at
`$MAIN_REPO/.oddkit/burndown-issue-descriptions/<n>.md` and write a 1-3 sentence plain-
language summary. For **Linked files**, scan the body (and comments, if any) for:
- Image/file attachments (`https://github.com/user-attachments/...`,
  `https://user-images.githubusercontent.com/...`)
- Markdown image refs (`![alt](url)`)
- Markdown links to docs, specs, screenshots, gists, or any external URL
- Bare URLs to the same

List each as `- <url> — <short label>`. If none, write `None.`.

```markdown
---
issue_number: 456
created_at: <iso utc>
---

# Clarifications — Issue #456

**Title:** <issue title>
**URL:** <issue url>

## Issue summary

<1-3 sentence summary of the issue body — what the developer is being asked to do, in plain
language. Distinct from the recon summary below, which is about where the work lands.>

**Linked files:**
- <url> — <short label, e.g. "screenshot of broken state" or "design spec PDF">
- <url> — <short label>

(If the issue body contains no file links, attachments, or external doc URLs, write
"None." instead of the bullet list.)

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

The frontmatter has no `status` field. The `[Answer]:` lines are the source of truth —
implement decides "answered" by parsing them. A separate status would just go stale the
moment the developer typed an answer.

After writing, set on the issue's tracking file:
- `clarifications_file: ".oddkit/burndown-clarifying-questions/<n>.md"` (relative to main repo)
- `phase: "awaiting_clarifications"`

For issues without clarifications:
- `clarifications_file: null`
- `phase: "ready"`

For `already_done` issues:
- `phase: "already_done"`
- `clarifications_file: null`

## Phase 7 — Print handoff and clean up

There's no session index file. Implement scans tracking JSON directly. Print a
human-readable summary to the terminal so the developer knows what to do.

```
## Burndown plan ready — <YYYY-MM-DD HH:mm UTC>

State: <main-repo>/.oddkit/

### Cohort (this run)
- Already complete: {P}
- Simple: {S}
- Complex: {C}
- Serialized chain: {K}

| # | Title | Class | Clarifications |
|---|---|---|---|
| 123 | Add CSV export | complex | needed → file |
| 456 | Refactor X | simple | n/a |
| 789 | Stub Y | already_done | n/a |

### Already complete
- **#789** — recon found existing impl at `src/y.ts:42`. Implement will post an evidence
  comment, no PR. If this looks wrong, edit the tracking file's `complexity` to `simple`
  or `complex` before running implement.

### Serialized chains
- **#123 → #456** — share `src/exporter.ts`. #456 stacks on #123's branch.

### Skipped — already planned
- **#321** — phase: ready. Run /oddkit:burndown-implement to ship, or delete the
  tracking file to re-plan.

### Files to fill in
- .oddkit/burndown-clarifying-questions/123.md
- .oddkit/burndown-clarifying-questions/456.md
(or: "No clarifications needed — run /oddkit:burndown-implement when ready.")

### Next step
Run /oddkit:burndown-implement. It scans .oddkit/burndown-issue-tracking/ and ships any
issue whose questions are answered (or didn't need any). Resumable: re-invoke any time
after interruption.
```

Then remove the recon worktree:

```bash
git -C "$MAIN_REPO" worktree remove --force "$RECON_WORKTREE"
```

The recon outputs (`<n>-recon.md`) are saved under `.oddkit/`. The worktree itself has
no further purpose.

Stop. Don't start implementation.

## Notes for the implementer

- **State lives in `$MAIN_REPO/.oddkit/`** — tracking, descriptions, clarifications,
  plans. Always absolute paths in agent prompts. The recon worktree is a read-only code
  view; never write state into it.
- Use `cwd:` / `git -C <path>` instead of `cd` in compound shell commands.
- Each tracking JSON is the only source of truth for its issue. No session index, no
  per-file status copies. `phase` is the canonical state; derive everything else.
- Write tracking files atomically (write to `.tmp`, then `mv`). Resumability depends on
  state on disk being consistent at every interrupt point.
- One issue's failure must never block another's progress. Independence is enforced by
  per-issue tracking files and per-issue worktrees at implement time.
- Re-running `/oddkit:burndown-plan` on issues that already have tracking files: skip
  them and tell the developer (Phase 1). Re-planning happens via deleting the tracking
  + clarifications files, not by overwriting.
