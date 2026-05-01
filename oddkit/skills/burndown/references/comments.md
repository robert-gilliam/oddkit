# Issue comment templates

The orchestrator posts one comment per issue at the end. Templates by outcome.

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

`/oddkit:burndown` attempted this issue but stopped after one retry.

**What failed**
<FAILURE_REASON>

**Where to pick up**
- Worktree: <WORKTREE>
- Branch: <BRANCH> (not pushed if STATUS=failed before push)

Resume with `/oddkit:burndown --resume <state-file> --retry <n>` after addressing the cause.
EOF
)"
```

## Blocked (predecessor failed)

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: skipped (blocked)

Skipped because predecessor #<predecessor> failed and this issue shares files with it.
Resolve #<predecessor> first, then re-run `/oddkit:burndown --resume <state-file>`.
EOF
)"
```

## Already complete

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Burndown: already complete

Recon for `/oddkit:burndown` found this issue's requirements already satisfied in the
current codebase. No PR was opened.

**Evidence**
- <file:line> — <one-line description>
- <file:line> — <one-line description>

**Rationale**
<one or two sentences explaining what recon found>

If this is wrong, reopen and re-run `/oddkit:burndown #<n>`.
EOF
)"
```

---

If a comment post fails (network/auth), log `comment_error: <reason>` to the state file and
continue. Write the intended body to `<BATCH_DIR>/comments/issue-<n>.md` so the developer can
hand-post it.
