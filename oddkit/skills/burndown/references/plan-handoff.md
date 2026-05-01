# Plan-generation agent handoff

Send this as the prompt when spawning a plan-generation Agent. Spawn with `model: sonnet`
— plans are structured output, not heavy reasoning. Substitute the bracketed placeholders.

---

Generate an implementation plan for a GitHub issue. Output a complete `.plan.md` file
following the structure below. Don't ask questions — all clarifications are provided.

**Shell rule:** never combine `cd` and `git` in a single compound bash command.

## Issue
[title, body, labels]

## Recon findings
[code-scout output + impact-scout output]

## Clarifications from the developer
[user's answers from Phase 4b for this issue, or "none"]

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
