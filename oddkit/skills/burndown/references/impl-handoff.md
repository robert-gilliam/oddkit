# Implementation agent handoff

Send this as the prompt when spawning an implementation Agent. Substitute the bracketed
placeholders before sending.

**Model:** spawn with `model: opus` for `complex` issues (real reasoning over a multi-file
plan). Spawn with `model: sonnet` for `simple` issues (one or two files, clear template).
In `--yolo`, also pass `mode: "bypassPermissions"`.

---

Implement a GitHub issue end-to-end: worktree, code, tests, PR. Don't ask questions —
everything you need is below. If something is genuinely undecidable, make the most reasonable
call and note it in your final report.

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Run them as
separate tool calls, or use `git -C <path>`.

## Issue
[number, title, body, url]

## Recon findings
[code-scout + impact-scout output]

## Plan
[full .plan.md content if complex; "No plan — implement directly from issue + recon" if simple]

## Branch base
[base branch — usually `main`, or the predecessor's branch for serialized issues]

## Steps

1. Create a worktree at `<main-repo>/.oddkit/worktrees/<BATCH_ID>-issue-<n>` from `<base>`.
   New branch: `burndown/issue-<n>-<slug>`. (For non-chain issues, branch off
   `origin/<base>` — orchestrator already fetched.)
   ```bash
   git -C <main-repo> worktree add .oddkit/worktrees/<BATCH_ID>-issue-<n> \
     -b burndown/issue-<n>-<slug> origin/<base>
   ```
2. **If a plan exists**, follow it phase by phase like `/oddkit:implement`: execute phase →
   run plan-specified verification → commit `Implement phase N: <name>` → tick the progress
   checkbox. **If no plan**, implement directly from the issue + recon. Commit once with a
   clear message.
3. Run the project's test command. Find it from `package.json` scripts, `Makefile`,
   `pyproject.toml`, or repo conventions. If unclear, run typecheck/build instead and note it.
4. **For complex issues with a plan**, spawn `@oddkit:intent-checker` on the full diff
   (`git diff <base>..HEAD`) to verify implementation matches plan intent. On DEVIATION,
   attempt one fix, then commit. If deviations remain, mark the issue `failed` and stop.
5. Push the branch:
   ```bash
   git -C <main-repo>/.oddkit/worktrees/<BATCH_ID>-issue-<n> \
     push -u origin burndown/issue-<n>-<slug>
   ```
6. Open the PR. Use conventional-commit type from labels (`bug` → `fix`,
   `feature`/`enhancement` → `feat`, default `chore`):
   ```bash
   gh pr create --base <base> --head burndown/issue-<n>-<slug> \
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
7. Report back in this exact shape (the orchestrator parses it):
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
   Do NOT comment on the issue yourself — the orchestrator handles that.

## Failure handling

If implementation, verification, or push fails, attempt one retry that addresses the specific
failure (re-read the failing test, fix it, re-run). If the second attempt also fails, stop
and return STATUS=failed with FAILURE_REASON and WORKTREE.
