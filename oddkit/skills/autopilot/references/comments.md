# Issue comment templates (autopilot)

Every comment carries an HTML marker on its last line so a re-run can find its own
comment and edit it instead of posting a duplicate. Upsert pattern (one Bash call):

```bash
MARKER='<!-- oddkit:autopilot-stop -->'
EXISTING=$(gh issue view <n> --json comments \
  --jq ".comments[] | select(.body | contains(\"$MARKER\")) | .id" | head -n1)
if [ -n "$EXISTING" ]; then
  gh api -X PATCH "/repos/<owner>/<repo>/issues/comments/$EXISTING" -F body=@"$BODY_FILE"
else
  gh issue comment <n> --body-file "$BODY_FILE"
fi
```

Write the body to a file first (`.oddkit/autopilot/comment-<n>.md`); special characters
bite inline heredocs. If a post fails, keep the file and name it in the summary so a
human can post it by hand. Don't retry inside the run.

---

## Questions (needs human)

Only the questions that failed the needs-human test. Multiple choice, your
recommendation first and marked. A human answers by replying in the thread with the
letter or free text; the next run reads it.

```markdown
## Autopilot: needs a decision before implementing

I can build this once the questions below are answered. Everything else about the issue
is clear enough to proceed. Reply in this thread with a letter per question (or prose);
re-run `/oddkit:autopilot #<n>` afterwards and it picks up from here.

**Done means:** <your best done-sentence, or "could not write one, see Q1">

### Q1: <question>
- A) <option> (recommended: <one clause why>)
- B) <option>
- C) <option>

### Q2: <question>
- A) <option> (recommended)
- B) <option>

<!-- oddkit:autopilot-questions -->
```

---

## Stop

One template, every stop reason. Posted on the issue.

```markdown
## Autopilot: stopped

**Reason:** <needs human | awaiting answers | emergency: rabbit hole | emergency: XL refactor | emergency: against intent | implementation failed | review | ci>

<Two to four sentences. What was attempted, what was found, why this reason applies.
For `review`: the verdict and the unmet requirement or failing test. For `ci`: the
failing checks after 3 fix rounds. For `emergency`: which of the three and the evidence.>

**What exists**
- PR: <url> | none
- Branch: <name> | none
- Worktree: <abs path> | none

**To resume**
<One exact instruction. "Answer the questions above and re-run `/oddkit:autopilot #<n>`."
"Fix the failing `lint` check on the PR and re-run `/oddkit:autopilot #<n>`." "Decide
whether to proceed with the full refactor; if yes, re-run with the decision in a comment.">

<!-- oddkit:autopilot-stop -->
```

---

## PR open, needs eyes

For a `Fix then merge` verdict, or a batch merge that conflicted. The PR is sound but not
merged.

```markdown
## Autopilot: PR ready for a look

<PR url>

Review and fix finished with **Fix then merge**: <one sentence on what warrants human
eyes>. CI is <green | none configured>. Not merged.

<For a batch conflict instead: "Could not update the branch onto the new base after #<m>
merged; conflicts in <files>. Resolve and merge by hand.">

<!-- oddkit:autopilot-needs-eyes -->
```

---

## Already complete

```markdown
## Autopilot: already complete

Recon found this issue's behavior already in the codebase. No PR opened.

**Evidence**
- `<file:line>` — <one line>
- `<file:line>` — <one line>

If this is wrong, say what's missing in a comment and re-run `/oddkit:autopilot #<n>`.

<!-- oddkit:autopilot-already-done -->
```

---

## Follow-up issue (manual steps)

Body for the one follow-up issue a run may file. Title:
`Manual steps for #<n>: <short description>`.

```markdown
## Problem
PR <url> implements #<n>, but the feature is inert until a person completes the steps
below. Autopilot cannot do them (credentials, vendor dashboards, production config).

## Steps
- [ ] <step, where, and what value or setting>
- [ ] <step>

## Context
Source issue: #<n>. PR: <url>. <One sentence on how the code behaves until this is done,
e.g. "Emails are skipped with a warning when SENDGRID_API_KEY is unset.">
```
