# Issue comment templates

The orchestrator posts one comment per issue at the end. Templates by outcome.

If a comment post fails, write the body to
`$MAIN_REPO/.oddkit/burndown-comments-pending/<n>.md` and set `comment_error` on the
tracking file. Don't retry inside the same run.

---

## Done (PR opened)

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: PR opened

<PR_URL>

**Summary**
<bullets from agent's SUMMARY>

**Verification**
- Tests: <TESTS>
- Plan compliance: <PLAN_COMPLIANCE>

<CAVEATS section if non-"none">
EOF
)"
```

## Failed

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: could not complete

`/oddkit:burndown-implement` attempted this issue but stopped after one retry.

**What failed**
<FAILURE_REASON>

**Where to pick up**
- Worktree: <WORKTREE>
- Branch: <BRANCH> (not pushed if STATUS=failed before push)

To retry: edit `.oddkit/burndown-issue-tracking/<n>.json` — set `phase: "ready"` and clear
`failure_reason` — then re-run `/oddkit:burndown-implement`.
EOF
)"
```

## Blocked (predecessor failed)

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: skipped (blocked)

Skipped because predecessor #<predecessor> failed and this issue shares files with it.
Resolve #<predecessor> first, then re-run `/oddkit:burndown-implement`.
EOF
)"
```

## Already complete

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: already complete

Recon found this issue's requirements already satisfied in the current codebase. No PR
was opened.

**Evidence**
- <file:line> — <one-line description>
- <file:line> — <one-line description>

**Rationale**
<one or two sentences from the tracking file's `rationale`>

If this is wrong, reopen the issue and either edit the tracking file's `complexity`
to `simple`/`complex` and re-run, or run `/oddkit:burndown-plan #<n>` for a fresh
session.
EOF
)"
```
