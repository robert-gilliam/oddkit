# Issue body template (fallback when no project create-issue skill exists)

Use this only in Phase 1 when `CREATE_ISSUE` is on and the project has no
`.claude/skills/create-issue/SKILL.md`. The issue body is a lightweight spec of what the
developer wants — not a design doc.

Create it with `gh issue create --title "<concise title>" --body "$(cat <<'EOF' … EOF)"`.

## Default template

```markdown
## Problem
<2-4 sentences: what's broken or missing, and why it matters. Cite real file paths from
recon when known.>

## Acceptance criteria
- [ ] <observable, testable outcome — a *what*, verifiable from outside the code>

## Files likely touched
- `path/to/file.ts` — <why, if non-obvious>
```

## What to include

- The problem, in plain language.
- Acceptance criteria that are observable from outside the code (a *what*, not a *how*).
- Real file paths surfaced during recon.

Add these two sections **only** when warranted:
- **Out of scope** — only if scope creep is a real risk.
- **Context** — only if a prior issue/PR explains why this exists.

## What to leave out

Implementation plans, refactor or architecture commentary, speculative edge-case lists,
future work. Those belong in the plan (Phase 2), not the issue.

**Exception:** write a thorough, detailed spec only if the developer explicitly asked for one.
