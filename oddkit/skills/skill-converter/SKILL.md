---
name: skill-converter
description: >
  Convert external skills into oddkit skills. Analyzes methodology, extracts what matters, strips ceremony.
  Use when the user wants to import, convert, port, or adapt an external skill into oddkit, or says /oddkit:skill-converter.
  Also trigger when the user mentions translating skills, making skills "oddkit-style", or rewriting bloated skills to be compact.
argument-hint: "<path-to-skill-or-directory>"
model: opus
---

# Skill Converter

Convert external skills into oddkit skills. Deeply understand the source, ask just enough to gauge intent, then produce a compact oddkit skill that keeps the methodology and drops the ceremony.

This is a mostly autonomous pipeline. One round of human input, then execution.

## Parse arguments

`$ARGUMENTS` should contain a path to either:
- A single SKILL.md file
- A skill directory (containing SKILL.md + references/scripts/agents)
- A parent directory containing multiple skills to convert together

If no path provided, ask: "Path to the skill or skill directory you want to convert?"

## Phase 1 — Ingest

Read everything in the source skill:
- SKILL.md (required)
- All files in references/, scripts/, assets/ subdirectories
- Any agent definitions referenced by the skill
- Frontmatter metadata (name, description, model, tools, context)

For skill groups (multiple skills in one directory), read all of them. Map their relationships — shared agents, cross-references, sequential workflows.

## Phase 2 — Deep Analysis

Think carefully about the source skill. Work through these questions internally (do not print this analysis):

**Purpose**: What does this skill actually accomplish? What's the core workflow? Strip away the framing and find the essential loop.

**Methodology**: What's the skill's theory of how to get good results? Sequencing, agent roles, verification steps, feedback loops. This is the part worth keeping.

**Strong points**: What does this skill do that's genuinely clever or effective? Patterns that produce better outcomes than naive approaches. Non-obvious sequencing. Smart use of parallel agents. Verification that catches real problems.

**Ceremony**: What's process for the sake of process? Verbose output templates, excessive confirmation gates, overwrought error handling, documentation theater, format policing that doesn't improve outcomes.

**Dependencies**: What tools, MCPs, or APIs does it require? What's optional vs essential?

**Scale**: Is this one skill or should it be split? Could multiple source skills merge into one?

## Phase 3 — Clarify

Present a brief explanation of what you found, then ask ONE ROUND of questions. Rules:

- Multiple choice when possible
- One question at a time (ask, wait for answer, ask next)
- After each multiple choice answer, restate the selected option by its full text before continuing
- Maximum 5 questions total — fewer if the intent is obvious
- Focus on decisions that change the output, not confirmations of what's obvious

Good questions to consider (pick only the relevant ones):

1. **Scope**: "This skill does X, Y, and Z. For oddkit, should it: (a) keep all three, (b) focus on X and Y, (c) just X?"
2. **Naming**: "I'd call this `<name>`. Works for you, or prefer something else?"
3. **Agents**: "The source uses N agents. I'd keep these M because [reason]. Drop the rest?"
4. **Autonomy**: "Should this follow oddkit's confirm/--yolo pattern, or run fully autonomous?"
5. **Integration**: "This overlaps with oddkit's existing `<skill>`. Merge or keep separate?"

Skip questions where the answer is obvious from context or oddkit conventions already dictate the choice.

## Phase 4 — Convert

Read these files for alignment before writing:
- `${CLAUDE_PLUGIN_ROOT}/../../docs/brand/strategy.md` — voice and philosophy
- `${CLAUDE_PLUGIN_ROOT}/../../docs/research-architecture.md` — plugin structure constraints
- `${CLAUDE_PLUGIN_ROOT}/../../CLAUDE.md` — project conventions

Write the oddkit skill following these principles:

### Structure
- Single SKILL.md under `${CLAUDE_PLUGIN_ROOT}/skills/<name>/`
- Reference files only if SKILL.md would exceed ~400 lines
- Agents in `${CLAUDE_PLUGIN_ROOT}/agents/` if the skill needs isolated parallel work

### Frontmatter
- `name`: kebab-case, short
- `description`: what it does + when to trigger. Be specific about trigger contexts.
- `argument-hint`: if it takes args
- `model`: opus unless the skill spawns many parallel agents on large inputs (then sonnet for agents)

### Writing the skill body

**Keep the methodology.** The source skill's sequencing, verification patterns, and agent architecture exist for reasons. Understand those reasons and preserve them — but express them in fewer words.

**Strip the ceremony.** Remove:
- Verbose output templates with lots of formatting scaffolding
- Excessive MUSTs and NEVERs (explain why instead)
- Documentation-heavy sections that describe what the skill is rather than what to do
- Confirmation gates beyond oddkit's confirm/--yolo pattern
- Error handling for scenarios that can't happen

**Match oddkit voice.** Imperative. Short sentences. No filler. Say it once. If the source skill says something in 3 paragraphs, say it in 3 lines.

**Preserve strong points.** If the source skill has a clever verification step, a smart agent architecture, or a non-obvious sequencing choice — keep it. Compress the expression, keep the insight.

**Use oddkit's autonomy pattern.** If the skill takes actions visible to others (GitHub, push, post), use the confirm/--yolo pattern from the existing review and address-feedback skills.

### Agents

If the source skill uses subagents worth keeping:
- Write agent definitions in `${CLAUDE_PLUGIN_ROOT}/agents/`
- Match the format of existing oddkit agents
- Set model to opus (sonnet if high-volume parallel work)
- Each agent gets a focused role, clear output format, and nothing else

### What to discard

- Configuration options that serve hypothetical users instead of the actual workflow
- Redundant validation (checking the same thing multiple ways)
- Output formatting beyond what's needed for the next step to consume
- Meta-commentary about the skill itself
- Fallback paths that paper over problems instead of failing clearly

## Phase 5 — Present and verify

Show the user the complete skill. Include:
- The SKILL.md content
- Any agent definitions
- Any reference files
- A one-line summary of what was kept, what was dropped, and why

Ask: "Look right? I can adjust before writing the files."

Write files only after confirmation.

## Phase 6 — Update project tracking

After writing files, append an entry to `${CLAUDE_PLUGIN_ROOT}/../../docs/decisions/LOG.md`:

```
- **{date}** [decision] — Converted `{source}` → `oddkit:{name}`. Kept: {what}. Dropped: {what}.
```

Check `${CLAUDE_PLUGIN_ROOT}/../../docs/TODO.md` — if skill-converter or the new skill appears in the future skills list, mark it done or add it.
