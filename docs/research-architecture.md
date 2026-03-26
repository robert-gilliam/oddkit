# Plugin Architecture Research

> Researched 2026-03-26. Sources: Anthropic docs, 10+ open-source plugins.

## Canonical Structure

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json           # Manifest (minimal: { "name": "..." })
├── skills/                   # One dir per skill
│   └── skill-name/
│       ├── SKILL.md          # Required entry point
│       └── reference.md      # Optional supporting files
├── agents/                   # Subagent definitions (markdown + YAML frontmatter)
│   └── agent-name.md
├── hooks/
│   └── hooks.json            # Event handlers
├── settings.json             # Default settings
└── .mcp.json                 # MCP server config (if needed)
```

## Component Types

| Type | Purpose | When to use |
|------|---------|-------------|
| Skills | Reusable workflow playbooks | Primary building block. Invoked as `/plugin:skill-name` |
| Agents | Isolated subagents with own context/model/tools | Parallel work, tool restrictions, delegation |
| Hooks | Event handlers (lifecycle points) | Automation, validation, gates |
| Commands | Legacy equivalent of skills | Don't use, skills are preferred |

## Skills vs Agents

- Skills run inline (or forked via `context: fork`). They're prompt-based playbooks.
- Agents always run isolated with their own model, tools, permissions.
- A skill orchestrates agents. Agents do focused work.

## SKILL.md Frontmatter

Key fields: `name`, `description`, `user-invocable`, `allowed-tools`, `model`, `context`, `agent`, `argument-hint`, `paths`.

Supports `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, dynamic context via `` !`command` ``.

## Naming

- Plugin/skill names: kebab-case
- Invocation: `/plugin-name:skill-name`
- Agents: `@agent-name` or `@plugin-name:agent-name`

## Distribution

- Marketplace repos (Git-based catalog, official: `anthropics/claude-plugins-official`)
- Direct: `claude --plugin-dir ./path`
- Project settings: `.claude/settings.json` under `enabledPlugins`
- Scopes: user, project, local, managed

## Patterns Observed

- **Flat skills dir** is most common and recommended
- **Shared agents** in `agents/` referenced by multiple skills
- **Minimal manifests** work fine (just name)
- **Supporting files** stay inside each skill's directory
- **SKILL.md under 500 lines**; large refs in separate files
