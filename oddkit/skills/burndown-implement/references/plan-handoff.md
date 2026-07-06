# Plan-generation agent handoff

Send this as the prompt when spawning a plan-generation Agent. Spawn with `model: opus`
— the plan determines everything the impl agent does downstream, so this is where
reasoning pays. Substitute the bracketed placeholders.

The plan agent reads and writes state files in `$MAIN_REPO/.oddkit/` — paths below are
absolute. It doesn't need a code worktree; everything it needs is on disk.

---

Generate an implementation plan for a GitHub issue. Output a complete `.plan.md` file
following the structure below. Don't ask questions — all clarifications are already
resolved on disk.

**Shell rule:** never combine `cd` and `git` in a single compound bash command.

## Issue
Read from `[<main-repo>/.oddkit/burndown-issue-descriptions/<n>.md]`.

## Recon findings
Read from `[<main-repo>/.oddkit/burndown-issue-tracking/<n>-recon.md]`.

## Clarifications
Read from `[<main-repo>/.oddkit/burndown-clarifying-questions/<n>.md]` (or `null` if no
clarifications were needed). Treat each `[Answer]:` line as authoritative. If an answer
is `agent's call`, choose the most reasonable option and note the decision in the plan's
"Key Decisions" section.

## Images
`[absolute paths from tracking JSON images array]` or `none`. If present, Read these
screenshots — they show the visual or bug state and often clarify scope. Factor them into
the plan.

## Output path
Write the plan to `[<main-repo>/.oddkit/burndown-plans/<n>.plan.md]`.

## Plan structure (required)

```
# <Title>
## Overview
## Key Decisions
## Risks
## Progress
- [ ] Phase 1: <name>
## Phase 1: <name>
### Step 1.1: <name>
## Acceptance Criteria
```

Be concrete: actual file paths, function names, patterns from recon. Each step says what
to do, which files, how to verify.

When done, return a single line: `PLAN_PATH: <absolute path>`.
