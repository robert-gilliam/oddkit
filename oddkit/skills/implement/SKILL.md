---
name: implement
description: >
  Execute an implementation plan phase by phase, with compliance checks and verification.
  Use when the user wants to implement a plan, execute a plan, run a plan, or says /oddkit:implement.
  Also trigger when the user says "implement this", "build from the plan", "execute the phases",
  "start implementing", or references executing work from an existing .plan.md file.
argument-hint: "[path/to/plan.md] [--yolo]"
model: opus
---

# Implement

Read a `.plan.md` file and execute it phase by phase. Each phase gets implemented, committed,
and compliance-checked against the plan before moving on. Progress checkboxes in the plan file
track state, so the skill can resume if interrupted.

The plan is the source of truth. Follow it. Don't generate plans — that's `/oddkit:plan`'s job.

**Shell rule:** Never combine `cd` and `git` in a single compound bash command (e.g., `cd foo && git diff`).
Run them as separate tool calls, or use `git -C <path>`. This applies to you and all subagents you spawn.

## Parse arguments

Extract from `$ARGUMENTS`:
- **Plan file path**: positional argument — a path to a `.plan.md` file
- **`--yolo`**: skip the initial confirmation gate

### Find the plan

If a path was provided, use it.

If no path provided, find plan files:

```bash
find . -name "*.plan.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null
```

- **One file found**: use it.
- **Multiple found**: list them and ask which one.
- **None found**: stop — "No plan files found. Create one with `/oddkit:plan` first."

Read the plan file. Store the full contents as `PLAN`.

## Step 1 — Validate the plan

Before doing any work, check that the plan is executable:

1. **Progress section exists.** Look for `## Progress` with checkbox items (`- [ ]` or `- [x]`).
   If missing, stop: "This plan has no Progress section. Run `/oddkit:plan` to fix it, or add one manually."

2. **Unchecked phases remain.** If all checkboxes are `[x]`, stop: "All phases complete. Nothing to implement."

3. **Phase sections exist.** Each unchecked item in Progress should reference a `## Phase N` section in the plan.
   If a referenced phase section is missing, stop and report which ones are missing.

4. **Steps are concrete.** Scan each phase's steps. If steps lack file references or specific actions
   (e.g., just "update the service" with no file path), warn: "Phase N has vague steps that may cause drift.
   Consider running `/oddkit:plan` to add specifics. Continue anyway? (yes / abort)"

Parse the plan into:
- `TITLE` — the H1 heading
- `KEY_DECISIONS` — the `## Key Decisions` section (if present)
- `RISKS` — the `## Risks` section (if present)
- `PHASES` — ordered list of phases, each with its section text and checked/unchecked status

Record the current HEAD commit as `BASE_COMMIT` — this is the baseline for the final verification diff.

## Step 2 — Confirm and begin

Show:

```
## Implement — <TITLE>

**Phases:** N total, M remaining
**Files affected:** <distinct file paths mentioned across unchecked phases>
**Approach:** <first sentence of Overview section>

Proceed? (yes / abort)
```

Unless `--yolo`, wait for confirmation. On abort, stop.

## Step 3 — Execute phases

For each unchecked phase in Progress order:

### 3a. Assess complexity

Count the steps (### headings within the phase) and distinct files mentioned.

- **Simple**: ≤3 steps AND ≤5 distinct files → execute inline
- **Complex**: >3 steps OR >5 distinct files → spawn a subagent

If a phase has >8 steps, warn before starting: "Phase N has {count} steps. Consider breaking it down
with `/oddkit:plan` if execution drifts."

### 3b. Execute the phase

**Simple — inline execution.**

Work through each step in order. Follow the plan's instructions exactly:
- Create, modify, or remove the specified files
- Follow the patterns the plan references (read them first)
- Run any verification commands the plan specifies

**Complex — spawn a subagent.**

Use the Agent tool to launch a fresh agent with this handoff:

> Implement this phase of a plan. Follow the instructions exactly. Do not skip steps,
> stub implementations, or declare anything out of scope.
>
> **Shell rule:** never combine `cd` and `git` in a single compound bash command
> (e.g., `cd foo && git diff`). Run them as separate tool calls, or use `git -C <path>`.
>
> ## Phase to implement
> <phase section text with all steps>
>
> ## Key Decisions
> <KEY_DECISIONS section>
>
> ## Risks to watch for
> <RISKS section>
>
> ## Prior work
> <summary of what earlier phases created/changed — file list and one-line descriptions>

### 3c. Run plan-specified verification

If the phase's steps include verification instructions (commands to run, things to check), execute them.

If verification fails:
1. Attempt to fix the issue
2. Re-run verification
3. If it fails again, stop: "Phase N verification failed after one fix attempt. Details: <error>"

### 3d. Commit

Stage all changes from this phase and commit:

```
Implement phase N: <phase name>
```

### 3e. Compliance check

Spawn a fresh subagent to compare the implementation against the plan:

> Compare this implementation against its plan. Check behavioral intent, not style.
>
> **Shell rule:** never combine `cd` and `git` in a single compound bash command.
> Run them as separate tool calls, or use `git -C <path>`.
>
> **Phase description:**
> <phase section text>
>
> **Key decisions:**
> <KEY_DECISIONS>
>
> **Changes made (diff):**
> <output of git diff HEAD~1>
>
> Check:
> 1. Were the specified files created, modified, or removed?
> 2. Does the implementation match the behavioral intent of each step?
> 3. Were verification instructions followed (if the plan specified any)?
> 4. Are there significant additions not in the plan, or steps that were skipped?
>
> For each issue:
> ```
> FILE: <path>
> STEP: <which plan step>
> SEVERITY: DEVIATION | DRIFT
> ISSUE: <one line>
> EXPECTED: <what the plan said>
> ACTUAL: <what was implemented>
> ```
>
> DEVIATION = wrong behavior. DRIFT = extra or skipped work that doesn't break intent.
>
> If everything matches: "No deviations found."

**On DEVIATION findings:**
1. Attempt one fix based on the report
2. Commit the fix: `Fix phase N compliance: <brief description>`
3. Re-run the compliance check on the combined diff (`git diff HEAD~2`)
4. If deviations remain, stop: "Phase N deviates from the plan after one fix attempt.
   Review the report and decide how to proceed."

**On DRIFT-only findings:** Log them in the output but continue.

### 3f. Update progress

Edit the plan file: change `- [ ] Phase N: <name>` to `- [x] Phase N: <name>`.

This must happen after the commit and compliance check pass — it's the durable record that the phase is done.

## Step 4 — Post-implementation verification

After all phases complete, get the full diff:

```bash
git diff <BASE_COMMIT>..HEAD
```

Spawn two agents in parallel on the full diff:

**@oddkit:bug-hunter** — runtime correctness issues in the new code.

**@oddkit:ship-blocker** — user-facing impact and security issues.

Collect findings. Verify each one against the actual code (same process as `/oddkit:review` Step 3b).
Discard hallucinated or invalid findings.

## Step 5 — Report

```
## Implementation Complete — <TITLE>

**Phases completed:** N/N
**Commits:** <list of commit messages with short hashes>

### Verification
- Bug Hunter: {N findings / clean}
- Ship Blocker: {N findings / clean}

<if findings, list each with FILE, SEVERITY, ISSUE>

### Next steps
- Run `/oddkit:review` to review the full diff
- Run tests if not already covered by plan verification steps
```

If BLOCKING findings exist, emphasize them at the top of the verification section.
Don't auto-fix cross-cutting issues — they need human judgment.
