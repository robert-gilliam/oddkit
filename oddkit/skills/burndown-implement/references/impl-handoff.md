# Implementation agent handoff

Send this as the prompt when spawning an implementation Agent. Substitute the bracketed
placeholders before sending.

**Model:** spawn with `model: opus` for `complex` issues, `model: sonnet` for `simple`.
Always pass `mode: "bypassPermissions"` — this is the unattended phase. If the harness
denies the spawn (auto mode can reject an approvals-off sub-agent), re-spawn without
`mode` — the denial isn't a failure, don't stop.

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
- Clarifications: `[<main-repo>/.oddkit/burndown-clarifying-questions/<n>.md]` or `null`
- Images: `[absolute paths from tracking JSON images array]` or `none` — screenshots
  from the issue. If present, Read them before implementing; they show the visual or bug
  state the change targets.
- Plan: `[<main-repo>/.oddkit/burndown-plans/<n>.plan.md]` or `null` (simple issues — implement from issue + recon + clarifications)
- Base branch: `[main | <predecessor branch>]`
- Per-issue worktree to create: `[<main-repo>/.oddkit/worktrees/burndown-issue-<n>]`
- Branch to create: `[burndown/issue-<n>-<slug>]`

## State updates

Update the tracking file (`<n>.json`) at every checkpoint. Use atomic writes (write
`<n>.json.tmp`, then `mv`). The orchestrator can be re-spawned if interrupted, so the
file must always be consistent.

**Read-modify-write — never reconstruct.** Every write must read the existing JSON,
mutate only the fields named for that checkpoint, and write the whole object back.
Never build the file from scratch with just the fields you know about — doing so silently
drops fields the orchestrator owns and depends on later (e.g. `clarifications_file`,
which the archive step in Phase 3 reads to move the answered questions out of the active
directory; if you drop it, the archive no-ops and the file is stranded). Preserve every
key you didn't explicitly change, including ones not documented here.

`phase` is the canonical state field. Don't write parallel boolean flags
(`implementation_complete`, `pushed_to_github`, etc.) — derive from `phase` and the
explicit result fields.

Checkpoints:
1. After worktree+branch created → `phase: "implementing"`, `worktree`, `branch`
2. After code+tests pass locally → `phase: "implementation_complete"`, `tests_status`,
   `plan_compliance`
3. After push + PR opened → `phase: "done"`, `pr_url`
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

3. **Implement — test-first.** Work in cycles. A cycle is one plan phase (with a plan) or
   one issue acceptance criterion (without). For each cycle, pick the approach silently
   from the work itself — never ask:
   - **Testable logic** (functions, APIs, data, branching) → write a failing test first,
     then the minimal code to pass it, then refactor with the test green. Type-check the
     cycle before moving on; type errors are blockers, not warnings.
   - **Observable but not unit-testable** (UI, config, infra, migrations) → define the
     observable check first (a script, a query, a render assertion), then implement to it.
   - **Pure rename/move/typo, no behavior change** → just make it; no test ceremony.

   Make the minimal correct change and fix the root cause, not the symptom. If you hit an
   adjacent problem outside the issue's scope, note it in CAVEATS rather than fixing it.
   If a test won't go green after two honest attempts, stop iterating — isolate the cause
   from first principles before a third try.

   Commit per cycle. Stage explicit paths (`git add <paths>`, never `-A`/`.`) and use a
   conventional message (`feat:`/`fix:`/`refactor:`/`test:`/`chore:`). With a plan, also
   tick the phase's progress checkbox in the plan file.

   **Scan every diff before you commit it** for:
   - race conditions — missing `await`, shared mutable state
   - off-by-one — loop bounds, slices, pagination
   - null/undefined handling that silently swallows errors
   - resource leaks — file handles, connections, listeners, timers
   - silent failures — empty `catch`, swallowed rejections
   - stale closures — hooks capturing outdated values

   If one applies and isn't mitigated, fix it in the same cycle or, if out of scope, name
   it in CAVEATS.

4. **Verify locally — match what CI runs.** Don't push code that CI will reject. Detect
   every verification command the project exposes and run them all:
   - `package.json` scripts: `lint`, `typecheck` (or `tsc`), `test`, `build`, plus any
     `check`/`ci`/`verify` aggregator script.
   - `Makefile` targets: `lint`, `typecheck`, `test`, `build`, `check`, `ci`.
   - `pyproject.toml` / `tox.ini` / `noxfile.py`: ruff/flake8/black, mypy/pyright,
     pytest, build.
   - Other ecosystems: detect by lockfile/config (`go vet` + `go test`, `cargo clippy` +
     `cargo test`, `bundle exec rubocop` + `bundle exec rspec`, etc.).

   Run every command that exists. Capture the exact command + pass/fail for each in your
   return summary. **If any command fails, do not push.** Treat it the same as a failing
   test: attempt one targeted fix, re-run the full set, and on second failure mark
   `phase: "failed"` with `failure_reason` naming the failing command.

   If the project genuinely has no verification commands (rare), note that explicitly in
   the return summary.

5. **Verify intent (complex only).** Spawn `@oddkit:intent-checker` on
   `git diff [base]..HEAD` to verify implementation matches plan intent. On DEVIATION,
   attempt one fix and commit. If deviations remain, mark `failed` and stop before push.

6. **Update tracking** to `phase: "implementation_complete"`.

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
   - Local checks: <one line per command run, e.g. "lint ✓, typecheck ✓, test ✓, build ✓">
   - Plan compliance: <pass/n-a + notes>
   EOF
   )"
   ```

9. **Update tracking** to `phase: "done"` + `pr_url`.

10. **Return** in this exact shape (the orchestrator parses it):
    ```
    STATUS: done | failed
    PR_URL: <url or "none">
    BRANCH: <branch name>
    WORKTREE: <absolute path>
    TESTS: pass | fail | skipped (one line per check run, e.g. "lint: pnpm lint ✓; typecheck: pnpm tsc ✓; test: pnpm test ✓; build: pnpm build ✓")
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
- If code+tests passed locally but push or PR open failed → `phase: "implementation_complete"`,
  `failure_reason: <push/PR error>`. The orchestrator may retry on the next implement run.
- Otherwise → `phase: "failed"`, `failure_reason: <one-line root cause>`.
- Return STATUS=failed.

This isolation is crucial: your failure must not affect other parallel issues.
