# Implement Skill

## Overview

Build `/oddkit:implement` — a skill that reads an oddkit plan file and executes it phase by phase, producing working code with built-in defenses against the failure modes of long-running autonomous workflows: planning deviations, context exhaustion, complexity avoidance, verification laziness, and entropy accumulation. The skill is the missing link between `/oddkit:plan` (which produces the plan) and `/oddkit:review` (which reviews the result).

## Key Decisions

1. **Plan file is the source of truth.** The skill reads a `.plan.md` file and follows it. It does not generate plans — that's `/oddkit:plan`'s job.
2. **Confirm once at the start, then run.** Show the plan summary, get a go/no-go, then execute autonomously. `--yolo` skips even that.
3. **Hybrid context management.** Simple phases run inline. Complex phases (>3 steps or >5 files) get a fresh subagent with a focused handoff prompt.
4. **Let the plan decide verification granularity.** If a phase has verification instructions, follow them. Otherwise commit per phase with a compliance check.
5. **Inline compliance checks.** After each phase, a fresh subagent compares implementation against the plan. No separate agent file — the check is a focused prompt within the skill. Extract to an agent later if multiple skills need it.
6. **Verification at the end.** Bug-hunter and ship-blocker check the full diff. Cleanup is left to `/oddkit:review`.
7. **Progress checkboxes are the state machine.** The skill updates `## Progress` in the plan file as phases complete, enabling resume on re-invocation.
8. **Commit per phase, fixup for corrections.** Each phase gets its own commit. If a compliance check requires fixes to a prior phase, those get a new fixup commit — never amend.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Compliance checker is too strict, flags non-deviations | Medium | Scope it tightly: check file targets and behavioral intent, not implementation style |
| Complex phase subagent exhausts its own context | Low | Warn if a phase has >8 steps; suggest breaking it down via plan skill |
| Plan file corruption on crash mid-checkbox-update | Low | Checkbox updates are small atomic edits via the Edit tool |

## Progress
- [x] Phase 1: Create the implement skill
- [x] Phase 2: Update TODO and README

---

## Phase 1: Create the implement skill

The core skill. Single file: `oddkit/skills/implement/SKILL.md`.

### Step 1.1: Frontmatter and argument parsing

Frontmatter fields following existing conventions:
- `name: implement`
- `description`: trigger phrases include "implement the plan", "execute the plan", "run the plan", `/oddkit:implement`
- `argument-hint: "[path/to/plan.md] [--yolo]"`
- `model: opus`

Argument parsing:
- **Plan file path**: positional argument. If omitted, glob for `*.plan.md` files. If one found, use it. If multiple found, list them and ask which one. If none found, stop.
- **`--yolo`**: skip the initial confirmation.

**Files:** `oddkit/skills/implement/SKILL.md` (new)

**Pattern to follow:** `oddkit/skills/plan/SKILL.md` for frontmatter and arg parsing, `oddkit/skills/address-feedback/SKILL.md` for the phased execution structure.

### Step 1.2: Plan validation (pre-task defense)

After reading the plan file, validate before starting:
- Does it have `## Progress` with at least one unchecked phase?
- Does each referenced phase section (`## Phase N`) exist?
- Do steps reference concrete files/actions (not vague "update the service")?
- Are there contradictions between Key Decisions and phase instructions?

If issues found, report them and stop: "This plan has gaps. Run `/oddkit:plan` to fix it, or address these manually."

If all phases are already checked, stop: "All phases complete. Nothing to implement."

### Step 1.3: Initial confirmation gate

Show a summary:
```
## Implement — <plan title>

**Phases:** N total, M remaining
**Files affected:** <list from plan>
**Approach:** <one-line from Overview>

Proceed? (yes / abort)
```

Unless `--yolo`, wait for confirmation. On abort, stop.

### Step 1.4: Phase execution loop

For each unchecked phase in `## Progress` order:

**1. Assess complexity.**
Count steps and distinct files mentioned. If >3 steps or >5 distinct files, mark as complex.

**2a. Simple phase — execute inline.**
Work through each step in order. Follow the plan's instructions: create/modify/remove the specified files, follow the patterns it references, run any verification commands it specifies.

**2b. Complex phase — spawn a subagent.**
Use the Agent tool to spawn a fresh agent. The handoff prompt includes:
- The phase section text (all steps)
- The `## Key Decisions` section
- The `## Risks` section (so the agent watches for known issues)
- A summary of what prior phases accomplished (which files were created/changed)
- Instruction: "Implement this phase exactly as described. Do not skip steps, stub implementations, or declare anything out of scope."

The anti-complexity-fear instruction is deliberate — agents avoid hard work unless told not to.

**3. Run plan-specified verification.**
If the phase's steps include verification instructions (commands to run, things to check), execute them. If verification fails, attempt to fix. If fix fails, stop and report.

**4. Commit.**
Stage and commit changes for this phase: `Implement phase N: <phase name>`

**5. Compliance check.**
Spawn a fresh subagent with this focused prompt:

> You are checking whether an implementation matches its plan. Compare the phase description against the actual changes.
>
> **Phase description and steps:** <phase text>
> **Key decisions:** <key decisions section>
> **Diff:** <git diff HEAD~1>
>
> Check:
> - Were the specified files created/modified/removed?
> - Does the implementation match the behavioral intent of each step?
> - Were verification instructions followed (if any)?
> - Are there significant additions or omissions not in the plan?
>
> For each issue found, output:
> ```
> FILE: <path>
> STEP: <which plan step this relates to>
> SEVERITY: DEVIATION | DRIFT
> ISSUE: <one line>
> EXPECTED: <what the plan said>
> ACTUAL: <what was implemented>
> ```
>
> DEVIATION = wrong behavior. DRIFT = extra work or skipped work that doesn't break intent.
> If everything matches, output: "No deviations found."

If DEVIATION findings:
- Attempt one fix based on the compliance checker's report
- Re-run the compliance check
- If it fails again, stop: "Phase N deviates from the plan after one fix attempt. Review the deviation report and decide how to proceed."

If only DRIFT findings: log them but continue.

**6. Update progress.**
Edit the plan file: change `- [ ] Phase N: <name>` to `- [x] Phase N: <name>`.

### Step 1.5: Post-implementation verification pass

After all phases complete, spawn two agents in parallel on the full diff (`git diff` from before the first phase commit to HEAD):

- `@oddkit:bug-hunter` — runtime correctness issues
- `@oddkit:ship-blocker` — user-facing impact and security issues

If BLOCKING findings: report them. Don't auto-fix — these are cross-cutting issues that need human judgment.

If only WARNINGs: report them as advisories.

### Step 1.6: Final report

```
## Implementation Complete — <plan title>

**Phases completed:** N/N
**Commits:** <list of commit messages>

### Verification
- Bug Hunter: {N findings / clean}
- Ship Blocker: {N findings / clean}

### Next steps
- Run `/oddkit:review` to review the full diff
- Run tests if not already covered by plan verification steps
```

**Files:** `oddkit/skills/implement/SKILL.md` (new)

**Verify:** Skill file exists, frontmatter is valid, follows oddkit conventions. Manually walk through the logic against the `self-update.plan.md` example to check it would produce sensible behavior.

---

## Phase 2: Update TODO and README

### Step 2.1: Mark implement as done in `docs/TODO.md`

Change `- [ ] \`implement\`` to `- [x] \`implement\`` in the Future Skills section.

**Files:** `docs/TODO.md`

### Step 2.2: Add implement to README skill list

Add the implement skill to the skills section of README.md, following the existing format.

**Files:** `README.md`

**Verify:** README lists implement with a description consistent with the other skills.

---

## Acceptance Criteria

- When `/oddkit:implement path/to/plan.md` is invoked, the skill reads the plan, shows a summary, and asks for confirmation before proceeding.
- When `--yolo` is passed, the skill skips the confirmation and runs immediately.
- When a phase is simple (≤3 steps, ≤5 files), it executes inline without spawning a subagent.
- When a phase is complex (>3 steps or >5 files), it spawns a fresh subagent with a focused handoff prompt.
- When a phase completes, its `## Progress` checkbox is updated to `[x]` in the plan file.
- When the skill is re-invoked on a partially-completed plan, it resumes from the first unchecked phase.
- When a compliance check detects a DEVIATION, the skill attempts one fix and re-checks. If it fails again, it stops with a report.
- When all phases complete, bug-hunter and ship-blocker run on the full diff and findings are reported.
- When all phases were already checked, the skill reports "nothing to implement" and stops.
