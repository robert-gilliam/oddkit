# oddkit — To-Do List

Status key: `[ ]` not started, `[~]` in progress, `[x]` done

---

## 1. Gain Clarity on Purpose

- [ ] Define the core problem this plugin solves (what pain does it address?)
- [ ] Decide if this is a personal tool, a team tool, or a public plugin
- [ ] Articulate a one-sentence mission for the plugin
- [ ] Decide on the plugin name (currently "oddkit" — is this final or placeholder?)

## 2. Branding Strategy

- [ ] Run `/brand:strategy` to explore positioning if distributing publicly
- [ ] Decide on plugin name, voice, and identity
- [ ] Determine if the plugin needs a distinct brand or is just a utility

## 3. Define Plugin Architecture

- [ ] **Research phase**: Study at least 10 real-world Claude plugins to understand how they structure their folders, define components, and organize skills vs. commands vs. agents
  - Document what patterns are common across plugins
  - Note what's canonical (from Anthropic docs) vs. what's convention vs. what's wild-west
  - Synthesize findings into a short research doc (e.g., `docs/research-architecture.md`)
- [ ] Ask clarifying questions about whether we want to follow the common patterns or diverge
- [ ] Learn about and choose between skills, commands, agents, and hooks for each capability
- [ ] Define the folder structure
- [ ] Create `.claude-plugin/plugin.json` manifest
- [ ] Decide how skills relate to each other (independent? pipeline? shared agents?)

## 4. Design Invocation Strategy

- [ ] **Research phase**: Study at least 10 real-world Claude plugins to understand invocation patterns
  - How do plugins name their skills? Short names? Verb-based? Noun-based?
  - Do plugins use one entry point with args, multiple distinct commands, or a mix?
  - How do plugins handle arguments and options?
  - Is there a canonical Anthropic recommendation, or is it wild-west?
  - What feels natural to type repeatedly?
  - Synthesize findings into a short research doc (e.g., `docs/research-invocation.md`)
- [ ] Ask clarifying questions about whether we want to follow conventions or try something different
- [ ] Decide on the top-level invocation pattern
- [ ] Define how to specify autonomy level — key design questions:
  - Natural language (e.g., "review this PR carefully") vs. explicit params (e.g., `--mode careful`)?
  - Presets (e.g., `auto`, `confirm`, `careful`) vs. granular controls?
  - Per-invocation or a session-level setting?
  - What are the autonomy boundaries? (push code? post comments? approve PRs?)
- [ ] Make invocation names memorable and intuitive
- [ ] Document the invocation patterns

## 5. Import and Restructure Existing Skills

- [ ] Import the four existing skills from `~/.claude/skills/`:
  - `pr-review`
  - `plan-pr-review`
  - `local-review`
  - `address-pr-feedback`
- [ ] Decide on restructuring — key questions:
  - Keep as separate skills or merge some? (e.g., pr-review + plan-pr-review → one skill with modes?)
  - Keep the end-to-end flows intact or break into composable pieces?
  - Which agents are shared across skills? Should they be defined once in `agents/`?
  - How do local-only workflows (local-review) differ from GitHub-connected ones?
- [ ] Rename skills to match the new invocation strategy
- [ ] Adapt skills to use plugin conventions (`${CLAUDE_PLUGIN_ROOT}`, proper frontmatter, etc.)
- [ ] Extract shared agent definitions into `agents/` directory

## 6. Design Autonomy Controls

- [ ] Define autonomy levels and what each one permits:
  - e.g., `auto`: push, comment, approve without asking
  - e.g., `confirm`: do the work, show me before posting
  - e.g., `careful`: pause at each decision point
- [ ] Decide where autonomy is configured (invocation arg? plugin setting? both?)
- [ ] Define the default autonomy level
- [ ] Identify all "action boundaries" where autonomy matters:
  - Pushing code to remote
  - Posting comments on GitHub
  - Approving/requesting changes on PRs
  - Creating commits
  - Modifying files
- [ ] Design how to communicate the current autonomy level to the user

## 7. Future-Proofing

- [ ] Think about what other skills/workflows might be added later
- [ ] Ensure the architecture can accommodate new skills without restructuring
- [ ] Consider whether hooks could automate any workflows (e.g., auto-review on push)
- [ ] Document extension points for future contributors

---

*This is a living document. Items will be added, refined, and reordered as we co-create the plugin.*
