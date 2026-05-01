# Implementation agent handoff

Send this as the prompt when spawning an implementation Agent. Substitute the bracketed
placeholders before sending.

**Model:** spawn with `model: opus` for `complex` issues, `model: sonnet` for `simple`.
Always pass `mode: "bypassPermissions"` — this is the unattended phase.

The agent operates from its **per-issue worktree** for code work. State files
(tracking/description/clarifications/plan) live in `$MAIN_REPO/.oddkit/` and are passed as
absolute paths.

---

Implement a GitHub issue end-to-end: worktree, code, tests, push, PR, status update.
Don't ask questions — every input is on disk. If something is genuinely undecidable
(an answer says `agent's call` or is missing context), make the most reasonable call
and note it in the PR body and your final report.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use
separate calls or `git -C <path>`.

## Inputs (all absolute paths)

- Main repo: `[<main-repo>]`
- Issue description: `[<main-repo>/.oddkit/burndown-issue-descriptions/<n>.md]`
- Recon: `[<main-repo>/.oddkit/burndown-issue-tracking/<n>-recon.md]`
- Tracking file (you write progress here): `[<main-repo>/.oddkit/burndown-issue-tracking/<n>.json]`
- Clarifications: `[<main-repo>/.oddkit/burndown-clarifying-questions/<n>-<session>.md]` or `null`
- Plan: `[<main-repo>/.oddkit/burndown-plans/<n>.plan.md]` or `null` (simple issues — implement from issue + recon + clarifications)
- Base branch: `[main | <predecessor branch>]`
- Per-issue worktree to create: `[<main-repo>/.oddkit/worktrees/burndown-<session>-issue-<n>]`
- Branch to create: `[burndown/issue-<n>-<slug>]`

## State updates

Update the tracking file (`<n>.json`) at every checkpoint. Use atomic writes (write
`<n>.json.tmp`, then `mv`). The orchestrator can be re-spawned if interrupted, so the
file must always be consistent.

Checkpoints (set `phase` and the matching boolean):
1. After worktree+branch created → `phase: "implementing"`, `worktree`, `branch`
2. After code+tests pass locally → `phase: "implementation_complete"`,
   `implementation_complete: true`, `tests_status`, `plan_compliance`
3. After push + PR opened → `phase: "done"`, `pushed_to_github: true`, `pr_url`
4. On terminal failure → `phase: "failed"`, `failure_reason`

Always update `updated_at` to current ISO UTC timestamp.

## Steps

1. **Worktree.** Create at the path above. Branch off `origin/[base]` (assume the
   orchestrator already fetched):
   ```bash
   git -C [main repo path] worktree add -b [branch] [worktree path] origin/[base]
   ```
   For serialized chains, `[base]` is the predecessor's local branch — use `[base]`
   directly without `origin/` prefix. If the worktree already exists (resume case), don't
   recreate. Verify the branch matches and continue from current state.

2. **Install (if needed).** Detect the lockfile (`pnpm-lock.yaml` → `pnpm install`,
   `package-lock.json` → `npm ci`, `Gemfile.lock` → `bundle install`, etc.) and run
   it from the worktree if `node_modules` / equivalent is missing.

3. **Implement.**
   - **With a plan**: follow phase by phase like `/oddkit:implement`. Execute phase →
     run plan-specified verification → commit `Implement phase N: <name>` → tick the
     progress checkbox in the plan file.
   - **Without a plan**: implement directly from issue + recon + clarifications. Commit
     once with a clear message.

4. **Test.** Run the project's test command (from `package.json`, `Makefile`,
   `pyproject.toml`, or repo conventions). If unclear, run typecheck/build instead and
   note that.

5. **Verify intent (complex only).** Spawn `@oddkit:intent-checker` on
   `git diff [base]..HEAD` to verify implementation matches plan intent. On DEVIATION,
   attempt one fix and commit. If deviations remain, mark `failed` and stop before push.

6. **Update tracking** to `implementation_complete` + `implementation_complete: true`.

7. **Push.**
   ```bash
   git -C [worktree] push -u origin [branch]
   ```

8. **Open PR.** Use conventional-commit type from labels (`bug` → `fix`,
   `feature`/`enhancement` → `feat`, default `chore`):
   ```bash
   gh pr create --base [base] --head [branch] \
     --title "<type>: <issue title>" \
     --body "$(cat <<'EOF'
   Closes #<n>

   ## Summary
   <2-4 bullets describing what changed>

   ## Verification
   - Tests: <pass/fail/skipped + command used>
   - Plan compliance: <pass/n-a + notes>
   EOF
   )"
   ```

9. **Update tracking** to `done` + `pushed_to_github: true` + `pr_url`.

10. **Return** in this exact shape (the orchestrator parses it):
    ```
    STATUS: done | failed
    PR_URL: <url or "none">
    BRANCH: <branch name>
    WORKTREE: <absolute path>
    TESTS: pass | fail | skipped (<command used>)
    PLAN_COMPLIANCE: pass | fail | n/a
    SUMMARY: <2-4 bullets, what changed at a behavior level>
    CAVEATS: <one line per caveat, or "none">
    FAILURE_REASON: <one-line root cause if STATUS=failed, else omit>
    ```
    Do NOT comment on the issue — the orchestrator handles that.

## Failure handling

If implementation, verification, or push fails, attempt one retry that addresses the
specific failure (re-read the failing test, fix it, re-run). If the second attempt also
fails:
- Update tracking: `phase: "failed"`, `failure_reason: <one-line root cause>`,
  `implementation_complete: false` (unless code+tests passed but push failed — in which
  case `implementation_complete: true`, `pushed_to_github: false`).
- Return STATUS=failed.

This isolation is crucial: your failure must not affect other parallel issues.
