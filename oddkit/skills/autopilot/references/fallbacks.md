# Built-in fallbacks for project-local skills

Autopilot prefers a project's own `enrich-issue` and `create-issue` skills, because they
carry that project's conventions. It uses them only when they accept `--yolo`; a skill
that stops to ask would hang an unattended run. Otherwise, do the steps below yourself.
They are the same shape as the project versions, minus the confirmation steps.

---

## Brief (fallback for `enrich-issue`)

Post for a **decided** issue, before implementation. The brief tells the humans what the
run is about to build and which calls it made, so they can object on the thread rather
than on the PR.

1. The thread was already read in triage. The resolved scope is your done-sentence
   from 1c; later comments override the body.
2. Keep recon light. Name the one or two real files the work touches; don't design the
   implementation.
3. Draft with the marker on the first line, so a re-run edits this comment instead of
   adding another (upsert as in `comments.md`).

```markdown
<!-- agent-brief -->
## Implementation brief

### Problem
<The resolved scope in two to four sentences, citing real paths. If the comments
changed the ask, say what changed: "The body asked for X; the 2026-05-02 comment
narrowed it to Y.">

### Done means
<Your done-sentence.>

### Decisions
<One bullet per decision from 1c: what was open, what you picked, why (precedent,
reversibility, or sensible default). This section is the whole reason the brief exists.>
- <open question> → <choice>. <why>

### Acceptance criteria
- [ ] <observable outcome>
- [ ] <observable outcome>

### Files likely touched
- `path` — <reason if not obvious>

### Linked context
<URLs from the thread. Drop the section if none.>
```

Add "Out of scope" only when scope creep is a real risk. No implementation plan.

Never edit the issue body, labels, milestone, or project fields. If the issue looks
mis-scoped, say so in the Decisions section; don't rescope it.

---

## Follow-up issue (fallback for `create-issue`)

Used only for a manual step inside scope, or a last-resort piece review-and-fix could not
finish.

1. You already know the files and the steps; no recon needed.
2. Body: the "Follow-up issue" template in `comments.md`. A lightweight spec, not a
   design doc. Problem, steps as checkboxes, context. No plans.
3. Create it, writing the body to a `mktemp` file:
   ```bash
   BODY=$(mktemp)
   # write the body to $BODY
   gh issue create --title "Manual steps for #<n>: <short>" --body-file "$BODY"
   ```
   Don't assign anyone. Don't add labels or milestones unless the project skill would
   have. Report the URL.
4. If creation fails partway, search before retrying so you don't create a duplicate:
   ```bash
   gh issue list --search "Manual steps for #<n>" --state open --json number,url
   ```
