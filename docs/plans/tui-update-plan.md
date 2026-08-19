# TUI Magic Words — Skill Enhancement Plan

## Overview

Enhance oddkit's existing skills with Claude Code's TUI tools (`TaskCreate`/`TaskUpdate`, `AskUserQuestion`) to give developers visible progress and structured option pickers during long-running operations. No new skills. No new agents. Just better UX in the skills we already have.

Two passes: Pass 1 adds task progress tracking to all multi-phase skills. Pass 2 adds structured pickers to key decision points. Ship Pass 1 first, validate it works, then layer on Pass 2.

## Key Decisions

1. **Two-pass delivery.** Task progress (Phases 1-3) ships first as a standalone improvement. AskUserQuestion pickers (Phases 4-5) come second. Each pass is independently useful.
2. **One task per phase, not per agent.** Parallel agents complete together — Claude processes all results before continuing. Per-agent sub-tasks would require interleaving TaskUpdate calls between agent results, which isn't guaranteed. Use one task for the agent-spawning phase and mark it complete when all agents return. Revisit per-agent granularity if testing shows Claude does interleave.
3. **No addBlockedBy initially.** Task dependency arrows require tracking runtime task IDs across skill instructions — a pattern no current skill uses. Sequential task completion already communicates ordering visually. Add dependency tracking later if the visual benefit justifies the complexity.
4. **Skip EnterPlanMode/ExitPlanMode.** The plan skill already has a well-defined conversational approval flow. Switching to native plan mode trades oddkit's control of the experience for Claude Code's built-in UX. Not worth it.
5. **Skip EnterWorktree.** The tool's documentation says "use ONLY when the user explicitly asks to work in a worktree." Programmatic use inside skills conflicts with its intended semantics. Current `git worktree add` commands work fine.
6. **No new flags or configuration.** These are internal UX improvements. The developer doesn't need to opt in or configure anything.
7. **activeForm strings are short, present-tense.** Follow the convention: "Spawning review agents", "Verifying findings", "Pushing commits". No ellipsis. No periods.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TUI tools change behavior in a future Claude Code release | Medium | Medium | Tools are used through standard tool calls, not internal APIs. Follow documented parameter schemas. Changes would affect all plugins equally. |
| Task IDs leak between skills if multiple skills run in one session | Low | Low | Each skill creates its own tasks. TaskCreate returns unique IDs. No collision risk — just visual clutter if a prior skill's tasks are still visible. |
| AskUserQuestion constrains responses to predefined options | Low | Medium | The tool always includes an automatic "Other" freeform option. Skills that need open-ended answers (business logic questions in Plan) should keep using plain text Q&A. |
| Skill file size increases ~15-20% from task management lines | Medium | Low | Each task needs create + in_progress + completed calls. For Review (4 tasks) that's ~12 new instructions; for Address Feedback (7 tasks) ~21. Mechanical and skimmable, but real. Only add tasks for phases where the developer actually waits — skip instant phases like "Identify PR." |
| Claude doesn't interleave TaskUpdate between parallel agent results | Medium | Low | Mitigated by using one task per phase, not per agent. If future testing shows interleaving works, we can add per-agent granularity. |

## Complexity Assessment

**Net complexity change: moderate-low.**

What's added:
- ~20-30 lines of task management per skill (create/update calls at phase boundaries). This is a ~15-20% size increase on skill files that are currently 100-230 lines. The added lines are mechanical and skimmable — create task, mark in_progress, mark completed — but the increase is real and should be acknowledged.
- In Pass 2: 1-3 AskUserQuestion calls in Plan and Review where structured pickers replace text prompts
- No new files, agents, abstractions, or configuration

What's preserved:
- All existing skill logic unchanged
- Same phases, same sequencing, same agent architecture
- Confirm/--yolo pattern unchanged
- All existing interaction points keep working

What gets simpler for the developer:
- Long operations show progress instead of silence
- Decision points present scannable options instead of walls of text (Pass 2)

**Verdict: this is a UX polish pass, not an architecture change.** The risk is low because we're layering presentation on top of existing logic, not restructuring it. The main cost is skill file verbosity, which is worth the developer-facing visibility.

## Progress

### Pass 1: Task Progress
- [ ] Phase 1: Add task progress to Review skill
- [ ] Phase 2: Add task progress to Plan skill
- [ ] Phase 3: Add task progress to Address Feedback skill

### Pass 2: Structured Pickers (after Pass 1 is validated)
- [ ] Phase 4: Add AskUserQuestion to Plan skill
- [ ] Phase 5: Add AskUserQuestion to Review skill

---

## Phase 1: Add task progress to Review skill

The review skill spawns 3-4 parallel agents, verifies findings, and outputs results. The agent-spawning and verification phases are the most opaque — the developer waits with no visibility.

### Step 1.1: Add task creation at skill entry

After parsing arguments and resolving the PR target, create tasks for each major phase:

```
TaskCreate: "Resolve target and get diff" / activeForm: "Resolving review target"
TaskCreate: "Run review agents" / activeForm: "Running review agents"
TaskCreate: "Verify findings" / activeForm: "Verifying findings against code"
TaskCreate: "Output results" / activeForm: "Preparing review output"
```

Mark each task `in_progress` when entering that phase, `completed` when done.

One task for the entire agent-spawning phase, not per-agent. Mark it complete after all agents return.

**Files:** `oddkit/skills/review/SKILL.md`

**Verify:** Run `/oddkit:review` on a local branch. Confirm task list appears with spinners during agent execution and checkmarks as phases complete.

---

## Phase 2: Add task progress to Plan skill

The plan skill has 5 steps with parallel recon agents. Task tracking makes the recon and stress-testing phases visible.

### Step 2.1: Add task creation after argument parsing

Create tasks for the major workflow steps:

```
TaskCreate: "Run reconnaissance" / activeForm: "Running reconnaissance"
TaskCreate: "Discovery Q&A" / activeForm: "Asking discovery questions"
TaskCreate: "Choose approach" / activeForm: "Evaluating approaches"
TaskCreate: "Stress-test approach" / activeForm: "Stress-testing for holes"
TaskCreate: "Write plan" / activeForm: "Writing plan document"
```

One task for recon (not per-agent). Mark complete after both code-scout and impact-scout return.

No addBlockedBy — sequential completion already communicates the flow.

**Files:** `oddkit/skills/plan/SKILL.md`

**Verify:** Run `/oddkit:plan` with a task description. Confirm task list shows progress through each phase with spinners and checkmarks.

---

## Phase 3: Add task progress to Address Feedback skill

This skill has 7 phases — the longest workflow. Task progress is highest-value here.

### Step 3.1: Add task creation after PR identification

Only create tasks for phases where the developer actually waits. Phases 1-2 (Identify PR, Set up workspace) are near-instant — no spinner needed.

```
TaskCreate: "Fetch review comments" / activeForm: "Fetching review comments"
TaskCreate: "Evaluate comments" / activeForm: "Evaluating feedback"
TaskCreate: "Implement fixes" / activeForm: "Implementing fixes"
TaskCreate: "Confirm with developer" / activeForm: "Preparing summary"
TaskCreate: "Push and respond" / activeForm: "Pushing commits and posting replies"
```

5 tasks instead of 7. Mark each `in_progress` when entering that phase, `completed` when done.

**Files:** `oddkit/skills/address-feedback/SKILL.md`

**Verify:** Run `/oddkit:address-feedback` on a PR with review comments. Confirm task list tracks phases with appropriate spinners. Verify instant phases (PR identification, workspace setup) happen without unnecessary task overhead.

---

## Phase 4: Add AskUserQuestion to Plan skill

The plan skill currently asks questions as plain text. Two interaction points benefit from structured pickers.

### Step 4.1: Use AskUserQuestion for approach selection (Step 3)

When presenting 2-3 approaches, use `AskUserQuestion` with:
- `header`: "Approach" (short chip label)
- Each option gets a `label` (approach name) and `description` (key tradeoff, 1-2 sentences)
- `preview`: architecture sketch or code pattern comparison for each approach (rendered as side-by-side markdown). Only use previews when there's something visual to compare — skip for purely conceptual choices.
- `multiSelect: false` — single selection

Add an instruction to the skill: "When presenting 2-3 approach options in Step 3, use the AskUserQuestion tool with structured options. If there's a clear best approach (recommend-and-confirm), use plain text instead."

### Step 4.2: Keep discovery Q&A as plain text

The iterative business logic questions in Steps 1-2 are conversational and context-dependent. Multiple choice options often can't be predetermined. Keep these as natural conversation.

Exception: when a discovery question has obvious discrete options (e.g., "Should we extend FooService or create a new one?"), the skill author can optionally use AskUserQuestion. Add a note: "Use AskUserQuestion when a discovery question has 2-4 clear discrete options. Default to plain text for open-ended questions."

**Files:** `oddkit/skills/plan/SKILL.md`

**Verify:** Run `/oddkit:plan` on a task with multiple viable approaches. Confirm the approach selection renders as an interactive picker with descriptions. Verify the "Other" option allows freeform input.

---

## Phase 5: Add AskUserQuestion to Review skill

The review skill's confirmation step (Step 4) currently shows findings as text and asks "Post this review?" This can be enhanced.

### Step 5.1: Use AskUserQuestion for post-review confirmation

Replace the text-based "Post this review to PR #N? (y/n)" with:

```
AskUserQuestion:
  question: "Post this review to PR #<number>?"
  header: "Review"
  options:
    - label: "Post all findings"
      description: "{N} issues ({B} blocking, {W} warnings) will be posted as inline comments"
    - label: "Show locally only"
      description: "Print findings to terminal without posting to GitHub"
    - label: "Abort"
      description: "Discard findings, do nothing"
  multiSelect: false
```

This replaces y/n with three clear actions.

### Step 5.2: Consider multiSelect for cherry-picking findings (deferred)

A multiSelect picker letting the developer toggle individual findings on/off before posting would be useful but adds complexity to the posting logic. The skill would need to track which findings were selected and only post those.

**Recommendation: defer this.** The current all-or-nothing flow works. If developers ask for selective posting, revisit in a future pass.

**Files:** `oddkit/skills/review/SKILL.md`

**Verify:** Run `/oddkit:review #<PR>` on a PR with findings. Confirm the confirmation step renders as an interactive picker with three options. Verify --yolo still bypasses the picker.

---

## Acceptance Criteria

### Pass 1
- When running `/oddkit:review`, task spinners appear during agent execution and tick off as phases complete.
- When running `/oddkit:plan`, task list shows progress through reconnaissance, Q&A, approach selection, stress-testing, and plan writing.
- When running `/oddkit:address-feedback`, tasks track the 5 non-instant phases with appropriate spinners.
- No new files created beyond skill edits.
- No changes to agent definitions.

### Pass 2
- When running `/oddkit:plan` with multiple viable approaches, approach selection renders as an interactive picker with descriptions. The "Other" option allows freeform input.
- When running `/oddkit:review #<PR>`, post-review confirmation uses structured picker (post all / show locally / abort) instead of text prompt.
- All `--yolo` flags bypass AskUserQuestion pickers (same as current text confirmations).

### Not in scope
- Skill Converter and Update skills are unchanged (too short or too simple to benefit).
- Per-agent sub-tasks (deferred until testing confirms Claude interleaves TaskUpdate between agent results).
- Task dependency arrows via addBlockedBy (deferred — sequential completion communicates ordering).
