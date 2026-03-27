---
name: plan
description: >
  Create an implementation plan. Explores the codebase in parallel, asks the developer about business logic,
  picks an approach, stress-tests it, and produces a phased plan ready for execution.
  Use when the user wants to plan work, create an implementation plan, think through an approach,
  or says /oddkit:plan. Also trigger when the user says "plan this", "how should we build this",
  "let's think through the implementation", or references planning a feature, fix, or refactor.
argument-hint: "[task description] [--out path/to/plan.md]"
model: opus
---

# Plan

Build an implementation plan by understanding the problem, exploring the codebase, asking the developer
about business logic, choosing an approach, and stress-testing it — all in one flow.

The goal: move rigor upstream. A good plan means code review catches less, because the thinking
already happened.

## Parse arguments

Extract from `$ARGUMENTS`:
- **Task description**: everything that isn't a flag. Can be a sentence, an issue reference, or a file path to a spec.
- **`--out <path>`**: explicit location for the plan file. If omitted, auto-detect (see Step 5).

If no task description provided, ask: "What are we planning?"

## Step 1 — Spawn recon and start the conversation

Do these simultaneously:

### Spawn two recon agents in parallel

Use the Agent tool to launch both. Pass each the task description and any context from arguments.

**@oddkit:code-scout** — finds project structure, relevant source files, patterns, conventions, and test approaches in the areas likely to be affected.

**@oddkit:impact-scout** — traces dependencies, integration points, recent changes, and existing documentation related to the task.

Both agents return structured findings. They run in the background while you talk to the developer.

### Start discovery with the developer

While recon runs, begin understanding the problem. Ask questions **one at a time, multiple choice when possible**.

Start with the basics:
1. What's the problem or feature? (if not clear from args)
2. Why does this matter now? What's the trigger?
3. What does success look like?

Keep questions short. Wait for each answer before asking the next one. After each multiple choice answer, restate the selected option by its full text before continuing (e.g., "Going with creating a parallel service.").

## Step 2 — Deepen understanding with recon findings

As recon agents complete, read their findings and use them to ask sharper questions. The recon gives you specifics — file names, patterns, dependencies — that turn vague questions into precise ones.

Examples of informed questions (pick what's relevant, skip what's obvious):

**Business logic:**
- "The current flow does X → Y → Z. Should the new behavior: (a) replace step Y, (b) add a step between Y and Z, (c) something else?"
- "I see there's already a `FooService` that handles similar logic. Should we: (a) extend it, (b) create a parallel service, (c) replace it?"

**Constraints:**
- "The existing tests use [pattern]. Should we: (a) follow the same pattern, (b) use a different approach because [reason]?"
- "This touches the [X] module which [detail from recon]. Any concerns about changing it?"

**Scope:**
- "I found [related thing] that might be affected. Is that: (a) in scope, (b) out of scope, (c) not sure yet?"

**Edge cases:**
- "What happens when [specific scenario from recon]? Should we: (a) handle it, (b) explicitly ignore it, (c) error?"

### How many questions to ask

Scale your questions to the complexity of the task. For a straightforward change with clear business logic, 3-5 questions may be enough. For complex features with branching logic, multiple stakeholders, or significant unknowns, ask more — 7-10 or beyond if needed.

**Always ask when you encounter:**
- Ambiguous business logic — if two reasonable interpretations exist, don't guess
- Critical branching decisions — choices that fundamentally change the implementation direction
- Gaps in your understanding — if you can't confidently describe what the system should do in a scenario, ask
- Uncertainty about scope boundaries — when it's unclear what's in vs out

**Don't ask about:**
- Things you can answer from the code
- Implementation details that don't affect the plan's direction
- Preferences that have no meaningful impact on the outcome

The right number of questions is however many it takes to have confidence in the plan. Stop when you could explain the full intended behavior to another developer without hedging.

## Step 3 — Choose an approach

Based on what you've learned from recon and the developer, determine the implementation approach.

**If there's a clear best approach:** Recommend it with a brief rationale. Mention what you considered and why this wins. Ask: "Does this direction sound right?"

**If there's genuine tension between approaches:** Present 2-3 options. For each:
- What it is (1-2 sentences)
- Key tradeoff (what you gain, what it costs)
- Best when: (which constraints favor it)

Ask the developer to pick. Don't present options when one is clearly better — that's false democracy.

## Step 4 — Stress-test the approach

One focused pass. For the chosen approach, work through:

**Where it holds** — handles naturally, no special attention needed.

**Where it bends** — works but needs an explicit decision, convention, or edge-case rule. These become notes in the plan.

**Where it leaks** — fails or creates a gap that needs design changes. These need to be resolved before the plan is final.

If you find leaks, surface them to the developer with proposed fixes. Resolve before proceeding.

Fold all bends into the plan as explicit callouts. Don't let implicit assumptions survive this step.

As you work through scenarios, collect the observable behaviors that define "done." These become the acceptance criteria in the plan. Edge cases that bent or leaked are often the most important ones to capture.

## Step 5 — Write the plan

### Find the right location

If `--out` was specified, use that path.

Otherwise, search the repo for where plans live:
1. Look for existing plan files (`*.plan.md`, `*-plan.md`, `implementation-plan*.md`) — use the same directory
2. Look for planning directories (`docs/plans/`, `docs/workstreams/`, `.plans/`)
3. Look for a docs directory with similar artifacts
4. Fall back to `docs/plans/` at the repo root

Create the directory if it doesn't exist. Name the file `<slug>.plan.md` where `<slug>` is a short kebab-case name derived from the task.

### Plan structure

```markdown
# <Title>

## Overview
<!-- 2-4 sentences. What we're building, why, and the chosen approach. -->

## Key Decisions
<!-- Decisions made during planning that affect implementation. -->
<!-- Include: approach chosen and why, scope boundaries, edge-case rulings. -->

## Risks
<!-- Where the approach bends or leaks. What to watch for. -->
<!-- Each risk: what it is, likelihood, mitigation. -->

## Progress
- [ ] Phase 1: <name>
- [ ] Phase 2: <name>

---

## Phase 1: <name>
<!-- What this phase accomplishes and why it's sequenced here. -->

### Step 1.1: <name>
<!-- What to do, which files to touch, what to verify. -->

### Step 1.2: <name>

---

## Phase 2: <name>

### Step 2.1: <name>

---

## Acceptance Criteria
<!-- Observable behaviors that define "done." -->
<!-- Format: "When [action/condition], [expected result]." -->
<!-- Scale depth to complexity: simple features get a few criteria, -->
<!-- complex features get thorough criteria plus a Test Scenarios subsection. -->

### Test Scenarios (complex features only)
<!-- Scenarios the implementing agent should write tests for. -->
<!-- Describe what to test, not how — let the implementer choose framework and structure. -->
<!-- Include: happy paths, edge cases, error conditions, boundary values. -->
```

**Phase -> Step breakdown.** Each phase is a logical chunk of work. Each step is a concrete action within that phase. Include:
- Which files to create, modify, or remove
- What patterns to follow (reference specific existing code when possible)
- What to verify after each step
- Dependencies between phases

**Keep it concrete.** Reference actual file paths, function names, and patterns from the recon findings. A plan that says "update the service layer" is useless. A plan that says "add a `processRefund` method to `src/services/billing.ts` following the pattern in `processCharge`" is actionable.

**Acceptance criteria scale to complexity.** Every plan gets acceptance criteria — observable behaviors written as "When [action/condition], [expected result]." For straightforward changes, 3-5 criteria covering the core behavior is enough.

For complex features (multi-phase plans, multiple modules affected, branching logic, significant edge cases from stress-testing), add the `### Test Scenarios` subsection. List the scenarios worth testing: happy paths, edge cases, error conditions, boundary values. Describe *what* to test, not *how* — the implementing agent picks the test framework, file structure, and assertions. The scenarios from Step 4's stress-test are the best source material here.

**Include gotchas.** If recon found something tricky (circular dependency, shared state, flaky test), call it out where it matters in the plan.

### Present before writing

Show the developer the complete plan. Ask: "Look right? I can adjust before saving."

Write the file only after confirmation.

Report the file path when done.
