---
name: logbook
description: Capture decisions, concepts, preferences, and insights from every session into docs/decisions/LOG.md
user_invocable: true
---

Capture everything worth remembering from the current session into `docs/decisions/LOG.md`.

User prompts are gold. Every prompt may contain design decisions, voice preferences, branding choices, corrections, or conceptual insights. Extract and log them. Don't wait to be asked.

## Entry types

- **Decision**: `- **YYYY-MM-DD** [decision] — [summary]`
- **Concept**: `- **YYYY-MM-DD** [concept] — [summary]`
- **Preference**: `- **YYYY-MM-DD** [preference] — [summary]`

## What to capture

- Choices made (name, architecture, audience, etc.)
- Insights, framings, or ideas worth remembering even if not yet decided
- Voice and style preferences, word choices to use or avoid
- Corrections — when the user redirects, that's a signal about what matters
- Scope clarifications — what oddkit is and isn't

## Rules

- Summarize, don't transcribe. One sentence per entry.
- Group related items into one entry when possible.
- Read the current log first to avoid duplicates.
- Append new entries to the end of the file.
- Do not edit or rewrite existing entries.
- If the file doesn't exist yet, create it with a `# Decision Log` heading first.
