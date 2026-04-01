# Review Agents Redesign

> Design doc. 2026-03-31.

## Problem

The review skill's code review agents (bug-hunter, ship-blocker, dx-critic) operate at the line/function level. None question the overall approach, search the codebase for simpler alternatives, or evaluate whether the change serves its stated business intent. The plan review agents (architecture-critic, simplicity-auditor) already have the right instincts for approach-level critique but only run on plans.

## Decision

Restructure from 7 agents to 5. Introduce a shared `design-critic` agent that works across both code and plan reviews, replacing architecture-critic, simplicity-auditor, and dx-critic.

## Agent Composition

### Code reviews (3 agents, parallel)

| Agent | Input | Question | Tools |
|-------|-------|----------|-------|
| bug-hunter | diff only | "Does it work?" | none |
| ship-blocker | diff only | "Is it safe?" | none |
| design-critic | diff + PR description + codebase | "Is it right?" | Glob, Grep, Read |

### Plan reviews (3 agents, parallel)

| Agent | Input | Question | Tools |
|-------|-------|----------|-------|
| fact-checker | plan text + codebase | "Are the claims true?" | Glob, Grep, Read |
| completeness-auditor | plan text + codebase | "Are there gaps?" | Glob, Grep, Read |
| design-critic | plan text | "Is the approach right?" | Glob, Grep, Read |

### Routing

- Code files in diff → code agents
- Markdown/docs only → plan agents
- Mixed → code agents only (tradeoff: doc changes in mixed PRs get no plan review — acceptable because mixed PRs are uncommon and code agents catch the higher-risk issues)

## Agent Definitions

### bug-hunter (unchanged)

Runtime correctness. Null access, logic errors, race conditions, type mismatches, unhandled errors, resource leaks. Gets the diff, nothing else. Ignores style, naming, tests, docs.

### ship-blocker (unchanged)

User impact and security. Broken flows, auth checks, data loss, API contracts, injection/XSS/secrets. Gets the diff, nothing else. Ignores internal tooling, style, performance unless it causes visible user impact.

### design-critic (new — replaces architecture-critic, simplicity-auditor, dx-critic)

Approach-level critique. Context-agnostic — the orchestrator frames what it's reviewing.

Scope:
- Questions whether the approach is the right one for the stated goal
- Searches the codebase for existing patterns/utilities that could replace the new code
- Flags overengineering, premature abstractions, unnecessary coupling
- Flags confusing abstractions, hidden coupling, misleading names, developer traps
- Suggests concrete simpler alternatives when they exist

Developer traps are as important as approach problems. A misleading function name that causes a bug in six months is worth reporting even when the overall approach is sound. The agent must not gravitate toward flashier approach-level findings at the expense of quiet, nasty traps.

Output includes a `SIMPLER:` field when proposing alternatives, and a `SUGGESTION:` field for approach alternatives that aren't strictly simpler.

The agent definition covers the lens (approach, simplicity, DX). The review skill provides context-specific framing:
- Code: "You're reviewing a code change. Here's the diff and the PR description. Search the codebase for existing patterns that could simplify or replace this approach."
- Plan: "You're reviewing an implementation plan. Here's the plan text. Evaluate whether the proposed design is sound, appropriately scoped, and as simple as it can be. Search the codebase for existing patterns that the plan could leverage."

### fact-checker (unchanged)

Validates claims against the codebase. Incorrect counts, nonexistent components, stale references, assumptions stated as facts. Must search with Glob, Grep, Read — no guessing.

### completeness-auditor (unchanged)

Gaps between problem and solution. Missing success criteria, ignored constraints, scope gaps, missing decisions that block implementation.

## Review Skill Changes

Only Step 2 of the review skill changes. Steps 1, 3, 4, 5 are untouched.

### Current Step 2

- Code → bug-hunter, ship-blocker, dx-critic
- Plan → fact-checker, architecture-critic, completeness-auditor, simplicity-auditor

### New Step 2

- Code → bug-hunter, ship-blocker, design-critic (with code framing)
- Plan → fact-checker, completeness-auditor, design-critic (with plan framing)
- Mixed → code agents only

### Changes

- Pass PR description to design-critic only (not bug-hunter or ship-blocker)
- Add orchestrator framing text for design-critic based on review type
- Design-critic gets codebase access instruction for code reviews

### Impact on implement skill

The implement skill spawns bug-hunter + ship-blocker for post-implementation verification. design-critic is not needed there — approach critique belongs at review time, not after code is already written.

## File Changes

- **Delete:** `agents/architecture-critic.md`, `agents/simplicity-auditor.md`, `agents/dx-critic.md`
- **Create:** `agents/design-critic.md`
- **Edit:** `skills/review/SKILL.md` (Step 2 agent list and framing)

## Design Principles

- **3 agents per review type** — within oddkit's target range, zero overlap between agents
- **Shared agent** — design-critic serves both contexts, reducing total agents from 7 to 5
- **Orchestrator owns context** — agent definitions stay clean, no if/else branching
- **Verification stays in orchestrator** — no judge agent, no confidence scoring. Evidence-based filtering in Step 3.
- **Mechanical agents stay mechanical** — bug-hunter and ship-blocker get the diff only. No PR description, no intent reasoning. Maximum differentiation between agents.
- **Swiss cheese model** — three specialized layers with different hole patterns, plus orchestrator verification as a fourth layer
