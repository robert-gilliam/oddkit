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
argument-hint: "[--base <branch>] <issue refs...>"
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
- **`--base <branch>`** (optional): override the base branch used for recon and per-issue
  worktrees. Defaults to the repo's default branch (whatever `origin/HEAD` resolves to,
  falling back to `main`, then `master`). The value is validated against `origin` after
  fetching; an unknown branch aborts the run.
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

Refresh all refs from origin first so any `--base` value is validated against current
remote state, not stale local refs:
```bash
git -C "$MAIN_REPO" fetch origin --prune
```

Resolve the base branch. Use `--base` if supplied, otherwise auto-detect:
```bash
# If --base <branch> was passed, BASE_BRANCH=<branch>
# Otherwise:
BASE_BRANCH=$(git -C "$MAIN_REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
  | sed 's|origin/||')
# Fallback to main, then master.
```

Verify the base exists on origin. Refuse to proceed with a non-existent base — surface a
clear error mentioning the value the developer passed (or that was auto-detected):
```bash
git -C "$MAIN_REPO" rev-parse --verify "origin/$BASE_BRANCH" >/dev/null 2>&1 \
  || { echo "Base branch 'origin/$BASE_BRANCH' not found on origin. Aborting."; exit 1; }
```

Initialize state directories in the **main repo's** `.oddkit/` (gitignored, branch-independent):
```bash
mkdir -p "$MAIN_REPO"/.oddkit/{burndown-issue-tracking,burndown-issue-descriptions,burndown-issue-images,burndown-clarifying-questions,burndown-archive-clarifying-questions,burndown-plans,burndown-comments-pending,worktrees}
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

## Phase 2 — Fetch issue descriptions and open PRs

### Issue descriptions

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

### Embedded images

Screenshots in an issue carry real signal — someone added them for a reason. Download
them now so recon, classification, and question authoring can all see them.

Scan the body **and comments** for image references in all three forms:
- HTML tags: `<img ... src="<url>" ...>` (GitHub's default paste format — easy to miss)
- Markdown: `![alt](<url>)`
- Bare attachment URLs: `https://github.com/user-attachments/assets/...` and
  `https://user-images.githubusercontent.com/...`

For each reference, download to
`$MAIN_REPO/.oddkit/burndown-issue-images/<n>/<NN>-<slug>.<ext>` (`<NN>` is a 2-digit
index in document order). Attachment URLs are auth-gated — a plain fetch 404s, so pass a
token:
```bash
mkdir -p "$MAIN_REPO/.oddkit/burndown-issue-images/<n>"
curl -sL -H "Authorization: token $(gh auth token)" -o "<dest>" "<url>"
```

Verify each download is actually an image (`file "<dest>"` reports an image type, or the
HTTP content-type was `image/*`). Keep only images:
- **Non-image attachment** (PDF, etc.) → don't store as an image; it still gets listed
  under Linked files in Phase 6 so the developer sees it.
- **Download failure** (auth, 404, network) → skip that one, remember the URL for a
  Phase 6 note (`⚠ couldn't fetch — view on GitHub`), and keep going. Never let an image
  fetch block planning an issue.

Cap at **6 images per issue**. If an issue references more, take the first 6 in document
order and `log()` how many were dropped — no silent truncation.

Hold each issue's downloaded-image list (path, source URL, alt text, `body`/`comment`)
for Phase 3, which writes it into the tracking file's `images` field. These images are
**not** deleted in Phase 7 — they persist under `.oddkit/` for implement to reuse.

### Open PRs (one fetch per batch)

Open PRs are shared context for every issue — fetch them once here, not per recon agent.
The result feeds Phase 4 (recon prompts) and Phase 5 (overlap heuristic):

```bash
gh pr list --state open \
  --json number,title,headRefName,body,files,updatedAt \
  --limit 100
```

Slim the result into a cache file. Body is trimmed to a single line (~150 chars, first
sentence or first line), `files` keeps only the path strings:

```
$MAIN_REPO/.oddkit/burndown-open-prs.json
```

Shape:
```json
{
  "fetched_at": "<iso utc>",
  "prs": [
    {
      "number": 7,
      "title": "Refactor frobnicator",
      "headRefName": "frob-refactor",
      "files": ["src/frobnicator.ts", "test/frobnicator.test.ts"],
      "body_summary": "<one line, ~150 chars>",
      "updatedAt": "<iso utc>"
    }
  ]
}
```

If `prs` is empty, log "no open PRs — base branch defaults to main for all issues" and
skip the open-PR logic in Phases 4–6. Tracking JSON's `base_branch` stays at the resolved
default; no Base branch section is added to clarifications files.

The file is transient — Phase 7 deletes it alongside the recon worktree.

## Phase 3 — Initialize tracking files

For each issue, write `$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>.json`. Use the
resolved `$BASE_BRANCH` from Phase 1 — the same value for every issue in this run, so
implement can branch off the right base:

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
  "images": [],
  "evidence": [],
  "recon_summary": null,
  "worktree": null,
  "branch": null,
  "base_branch": "main",
  "plan_file": null,
  "pr_suggestion": null,
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

Populate `images` from the Phase 2 downloads for this issue (empty array if none). Each
entry records where the image came from so implement can reuse it later:
```json
"images": [
  {
    "path": ".oddkit/burndown-issue-images/456/01-broken-promo.png",
    "source_url": "https://github.com/user-attachments/assets/7189...",
    "alt": "Image",
    "from": "body"
  }
]
```
`path` is relative to `$MAIN_REPO`, matching `clarifications_file`'s convention.

## Phase 4 — Recon all issues in parallel

For each issue, spawn `@oddkit:code-scout` and `@oddkit:impact-scout` via the Agent tool —
**`model: sonnet` on every call**. Pass the issue title and body. Tell each agent to:
- Read code from `$RECON_WORKTREE` (pass it as `cwd`) so they see fresh `origin/<base>`.
- Write any output files to absolute paths under `$MAIN_REPO/.oddkit/`.

### Embedded images for every recon prompt

If the issue's tracking JSON has a non-empty `images` array, append this block (absolute
paths, one per image). Omit it entirely when there are none:

```
## Screenshots from the issue

Read these before reconning — they show the visual or bug state and inform where the
work lands:
- <abs path to 01-...png>
- <abs path to 02-...png>

In your output, include a one-line "Visual note" describing what the screenshots show
that's relevant to the implementation.
```

### Open-PR context for every recon prompt

Append a compact open-PR block to each recon agent's prompt, built from
`$MAIN_REPO/.oddkit/burndown-open-prs.json` (cached in Phase 2). If `prs` is empty, omit
the whole block. Otherwise:

```
## Open PRs in this repo (file-overlap context)

- PR #7 "Refactor frobnicator" (head: frob-refactor) — files: src/frobnicator.ts, test/frobnicator.test.ts. Body: "<one line>"
- PR #12 "Auth rewrite" (head: auth-rewrite) — files: src/auth/session.ts, src/auth/middleware.ts. Body: "<one line>"

If the files you identify as this issue's touch set intersect with any PR's files, run
`gh pr view <n>` to confirm conceptual overlap, then include a "Likely PR overlap"
section in your output:

## Likely PR overlap
- PR #N (head: <ref>) — <one line: what likely overlaps and why it matters>

If no overlap, omit the section.
```

This is bonus context — the orchestrator still computes file overlap mechanically in
Phase 5. The recon agent's note (if any) gets folded into the Base branch section's
explanation in Phase 6.

Run all `2 * len(issues)` calls in one message.

When agents return, write a 2-3 line `recon_summary` into each tracking file: where the
work lands, what pattern to follow. Save full recon output as
`$MAIN_REPO/.oddkit/burndown-issue-tracking/<n>-recon.md` for reference at implement time.

## Phase 5 — Classify and detect overlap

### Classify (you, inline)

For each issue, decide from issue text + recon. If the issue has downloaded images, Read
them first — someone added those screenshots for a reason, and they often disambiguate
scope (which screen, which state, how much is broken). Factor them into the call.

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

### Detect open-PR overlap (per issue)

Skip if `burndown-open-prs.json` has no PRs. Otherwise, for each issue:

1. Build `issue_touch_set` from the union of paths in recon's "Relevant Files" and
   "Dependencies" sections. Normalize to repo-relative paths.
2. For each cached PR, compute `intersection = issue_touch_set ∩ pr.files`. A PR is
   *relevant* if `intersection` is non-empty.
3. Pick the suggestion:
   - 0 relevant PRs → `pr_suggestion = null`.
   - 1+ relevant PRs → pick the one with the largest `updatedAt` (most recently updated).
     Intersection size is not a tiebreaker — recency wins.
4. Write `pr_suggestion` to tracking JSON when non-null:
   ```json
   "pr_suggestion": {
     "pr_number": 7,
     "head_ref_name": "frob-refactor",
     "title": "Refactor frobnicator",
     "overlap_files": ["src/frobnicator.ts"]
   }
   ```

`base_branch` in tracking JSON is *not* changed here — it stays at the resolved
`$BASE_BRANCH` from Phase 1. The dev's answer (or the pre-filled suggestion they accept)
gets baked into `base_branch` at implement time when answers are parsed.

Surface only direct overlaps. No transitive stacking detection (PR-on-PR-on-PR). If the
dev wants chains, they handle it manually by editing the answer.

## Phase 6 — Write clarifying-questions files (one per issue that needs them)

This is the whole point. One file per issue, multiple choice, `[Answer]:` after each
question. The developer fills them in offline.

### Decide whether an issue needs a clarifications file

Write one when **any** of these is true:
- Ambiguous business logic
- Branching design (pattern A vs B, both plausible)
- Scope uncertainty (does X include Y?)
- Unresolved edge cases
- `pr_suggestion != null` (recon detected open-PR overlap — surface the stacking choice)

Skip when recon + issue body fully define the work *and* there's no PR overlap to
surface. Sharper questions beat blanket coverage.

`already_done` issues: no clarifications file regardless of PR overlap. The evidence is
in the tracking file and the handoff summary; the developer can sanity-check before
running implement.

`simple` issues with clear acceptance criteria and no PR overlap: no file.

Cap content questions at 3-5 when needed. The Base branch section is in addition.

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
language summary. Before writing it, Read the issue's downloaded images (from tracking's
`images` array) so the summary reflects what the screenshots actually show — not just the
text around them.

For **Linked files**, scan the body (and comments, if any) for:
- HTML image tags (`<img src="url">`) and image/file attachments
  (`https://github.com/user-attachments/...`, `https://user-images.githubusercontent.com/...`)
- Markdown image refs (`![alt](url)`)
- Markdown links to docs, specs, screenshots, gists, or any external URL
- Bare URLs to the same

List each as `- <url> — <short label>`. For images that were downloaded, append the local
path so the dev can open it: `- <url> — screenshot of broken state (local: <path>)`. For
any image that failed to download, note it: `- <url> — ⚠ couldn't fetch, view on GitHub`.
If none, write `None.`.

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

## Base branch

Which branch should this issue be implemented on top of?

- `<default base>` (default) — start fresh from the default base
- `<headRefName>` — stack on top of PR #<n>: "<PR title>"
  Overlap: <comma-separated overlapping files>
  Why: <one-line explanation: which files overlap and what's likely affected.
        Include any extra context the recon agent surfaced under "Likely PR overlap".>

[Answer]: <pre-filled with headRefName when pr_suggestion != null, otherwise the default base>

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

### Rendering the Base branch section

Two shapes, depending on `pr_suggestion`:

**With suggestion** (`pr_suggestion != null`): list both options, pre-fill the
`[Answer]:` with the suggested `head_ref_name`, and write a one-line "Why" using the
`overlap_files` plus any recon-agent note from "Likely PR overlap".

**No suggestion** (`pr_suggestion == null`): single-option list, no "Overlap" / "Why"
lines, `[Answer]:` pre-filled with the default base:

```markdown
## Base branch

Which branch should this issue be implemented on top of?

- `main` (default) — start fresh from main

[Answer]: main
```

The Base branch section is always present in a clarifications file. Consistency makes
it easy to spot when the dev has overridden the pre-fill.

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

### Stacking suggestions pre-filled
- **#123** → suggested base: `frob-refactor` (PR #7) — overlap: `src/frobnicator.ts`
- **#456** → suggested base: `auth-rewrite` (PR #12) — overlap: `src/auth/session.ts`

(Omit this section entirely when no issue in the run has a `pr_suggestion`.)

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

Then remove the recon worktree and the transient open-PR cache:

```bash
git -C "$MAIN_REPO" worktree remove --force "$RECON_WORKTREE"
rm -f "$MAIN_REPO/.oddkit/burndown-open-prs.json"
```

The recon outputs (`<n>-recon.md`) are saved under `.oddkit/`. The recon worktree and
open-PR cache have no further purpose — every per-issue suggestion is durable in
tracking JSON's `pr_suggestion` and in the clarifications file.

**Don't delete `burndown-issue-images/`.** Downloaded screenshots persist under
`.oddkit/` and are referenced by tracking JSON's `images` array so implement can reuse
them. They're cleaned up with the rest of `.oddkit/` state when the developer is done.

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
