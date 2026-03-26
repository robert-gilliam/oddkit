# oddkit

This is a Claude Code plugin project. We are building it iteratively.

## Conventions

- Be concise. Say it once, say it clearly.
- Keep it simple. Don't overengineer.
- Don't add features, abstractions, or configurability beyond what's needed right now.
- Prefer flat structures over deep nesting.
- When in doubt, do less.

## Working With Me

- Ask me questions one at a time. Don't overwhelm me with a wall of questions.
- Multiple choice is preferred when asking questions.
- This is a co-creation process. Teach me as we go — explain plugin terminology, conventions, and best practices when they come up naturally.
- I'm new to Claude plugins. Use the official Anthropic docs as the canonical source for folder structures, terminology, and conventions.

## What We're Building

A Claude Code plugin that packages my PR review skills into a simple, easy-to-invoke collection. The four skills being imported:

1. **pr-review** — Review a PR's code using parallel subagents (Bug Hunter, Ship Blocker, DX Critic)
2. **plan-pr-review** — Review PRs containing plans/docs using specialized agents (Fact Checker, Architecture Critic, Completeness Auditor, Simplicity Auditor)
3. **local-review** — Self-review changes locally before pushing (terminal output, no GitHub interaction)
4. **address-pr-feedback** — End-to-end workflow for addressing GitHub PR review comments

These skills may be renamed, rearranged, or restructured as part of this project.

## Key Design Goals

- **Simple invocation** — one entry point or a small set of easy-to-remember slash commands
- **Flexible autonomy** — ability to dial up/down how much the plugin does autonomously (fully automated vs. confirmation checkpoints vs. careful/manual)
- **Distribution-ready** — structured so it could be shared as a plugin via a marketplace
- **Extensible** — designed so more skills and agentic workflows can be added later

