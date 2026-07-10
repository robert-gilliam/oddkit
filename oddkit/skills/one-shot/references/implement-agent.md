# Implementation agent handoff (one-shot)

Send this as the prompt when spawning the single implementation Agent. Substitute the
bracketed placeholders before sending. **Model:** `opus` for complex tasks, `sonnet` for
simple. Always pass `mode: "bypassPermissions"` — this is the unattended phase.

This is one-shot's lean cousin of burndown's impl handoff: same TDD/verify/PR discipline,
but inputs arrive inline (no tracking JSON, no clarifications file) and the result comes back
in the agent's final message rather than through state on disk.

---

Implement a single task end-to-end: worktree, code (test-first), local verification, push,
PR. Work fully autonomously — do not ask questions. Every ambiguity is your call: pick the
most reasonable option and record it in the PR body under "Decisions." The **only** thing
you escalate instead of deciding is a genuine emergency (see "Emergency" below).

**Shell rule:** never combine `cd` and `git` in a single compound bash command. Use separate
calls or `git -C <path>`.

## Inputs

- Main repo: `[<main-repo-abs-path>]`
- Task spec (authoritative "what done means"): `[<ISSUE_SPEC text>]`
- Recon findings (where the work lands, patterns, blast radius): `[<recon output>]`
- Plan (complex tasks only, else "none"): `[<plan text>]`
- Base branch: `[<BASE_BRANCH>]`
- Closes issue: `[#<n>]` or "none"
- Worktree to create: `[<main-repo>/.oddkit/worktrees/one-shot-impl]`
- Branch to create: `[one-shot/<short-slug>]`

## Steps

1. **Worktree.** Branch off fresh origin base (the orchestrator already fetched):
   ```bash
   git -C [main-repo] worktree add -b [branch] [worktree] origin/[base]
   ```
   If the worktree already exists (resume), don't recreate — verify the branch and continue.

2. **Install (if needed).** Detect the lockfile (`pnpm-lock.yaml` → `pnpm install`,
   `package-lock.json` → `npm ci`, `Gemfile.lock` → `bundle install`, `go.mod`, `Cargo.toml`,
   `poetry.lock`/`uv.lock`, etc.) and install from the worktree if deps are missing.

3. **Implement — test-first.** Work in cycles; a cycle is one plan phase (with a plan) or one
   acceptance criterion (without). For each cycle pick the approach silently from the work:
   - **Testable logic** (functions, APIs, data, branching) → write a failing test first, then
     the minimal code to pass it, then refactor with the test green. Type-check each cycle;
     type errors are blockers, not warnings. This is the deterministic test coverage the
     pipeline relies on — prefer real assertions over smoke tests.
   - **Observable but not unit-testable** (UI, config, infra, migrations) → define the
     observable check first (a script, a query, a render assertion), then implement to it.
   - **Pure rename/move/typo, no behavior change** → just make it; no test ceremony.

   Make the minimal correct change and fix the root cause, not the symptom. Commit per cycle:
   stage explicit paths (`git add <paths>`, never `-A`/`.`) with a conventional message
   (`feat:`/`fix:`/`refactor:`/`test:`/`chore:`). If a test won't go green after two honest
   attempts, stop and isolate the cause from first principles before a third try.

   **Scan every diff before committing** for: missing `await`/races, off-by-one, null/undefined
   that silently swallows errors, resource leaks (handles, connections, listeners, timers),
   empty `catch`/swallowed rejections, stale closures. Fix any that apply in the same cycle, or
   name it under "Caveats" if it's genuinely out of scope.

4. **Verify locally — match what CI runs.** Don't push code CI will reject. Detect and run
   *every* verification command the project exposes:
   - `package.json` scripts: `lint`, `typecheck`/`tsc`, `test`, `build`, and any
     `check`/`ci`/`verify` aggregator.
   - `Makefile` targets: `lint`, `typecheck`, `test`, `build`, `check`, `ci`.
   - `pyproject.toml`/`tox.ini`/`noxfile.py`: ruff/flake8/black, mypy/pyright, pytest, build.
   - Other ecosystems by lockfile/config (`go vet` + `go test`, `cargo clippy` + `cargo test`,
     `bundle exec rubocop` + `rspec`, etc.).

   Run every command that exists; capture each command + pass/fail for the return. **If any
   fails, do not push** — attempt one targeted fix, re-run the full set, and on a second
   failure return `STATUS: failed` naming the failing command. If the project genuinely has no
   verification commands, say so in the return.

5. **Push.**
   ```bash
   git -C [worktree] push -u origin [branch]
   ```

6. **Open the PR.** Choose the conventional-commit type from the task (bug → `fix`,
   feature/enhancement → `feat`, else `chore`):
   ```bash
   gh pr create --base [base] --head [branch] \
     --title "<type>: <concise task title>" \
     --body "$(cat <<'EOF'
   [Closes #<n>   — omit this line if no issue]

   ## Summary
   <2-4 bullets: what changed at a behavior level>

   ## Decisions
   <any ambiguity you resolved yourself and why — or "none">

   ## Verification
   - Local checks: <one line per command, e.g. "lint ✓, typecheck ✓, test ✓, build ✓">

   ## Caveats
   <out-of-scope issues noticed, or "none">
   EOF
   )"
   ```

7. **Return** exactly this shape (the orchestrator parses it):
   ```
   STATUS: done | failed | emergency
   PR_URL: <url or "none">
   HEAD_BRANCH: <branch name>
   WORKTREE: <absolute path>
   TESTS: <one line per check, e.g. "lint: pnpm lint ✓; typecheck: tsc ✓; test: pnpm test ✓; build: pnpm build ✓">
   SUMMARY: <2-4 bullets, behavior-level>
   CAVEATS: <one line per caveat, or "none">
   FAILURE_REASON: <one line if STATUS=failed, else omit>
   EMERGENCY_REASON: <if STATUS=emergency: which of rabbit-hole / XL-refactor / against-intent, and why, else omit>
   ```
   Do NOT merge, and do NOT comment on the issue — the orchestrator owns those.

## Emergency

If, mid-implementation, the task turns out to require breaking regressions you can't contain
without the work spiraling (rabbit hole), an XL refactor of a subsystem or widely-depended-on
interface, or a change that runs against the app's clear intent — do **not** thrash through
it. Stop, leave your worktree and any commits in place, and return `STATUS: emergency` with
`EMERGENCY_REASON`. The orchestrator decides whether to proceed, narrow, or abort. This is
reserved for genuine walls — a merely large or multi-file change is normal work, not an
emergency.

## Failure handling

On implementation/verification/push failure, attempt one retry addressing the specific
failure. If the second attempt also fails, return `STATUS: failed` with a one-line
`FAILURE_REASON`. Leave the worktree in place so the orchestrator can point a human at it.
