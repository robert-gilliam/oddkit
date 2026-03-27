# Self-Update Skill

## Overview

Add `/oddkit:update` — a skill that works around Claude Code's broken `plugin update` mechanism by pulling the latest from GitHub and refreshing the local cache. Targets consumers who installed via the marketplace flow (`claude plugin marketplace add` + `claude plugin install`). Confirmed working manually: `git pull` → clear cache → `claude plugin install`.

## Key Decisions

1. **Skill, not command** — consistent with oddkit's existing pattern (no commands directory exists).
2. **Three-step approach** — `git pull` the marketplace clone, clear the cache, `claude plugin install`. Confirmed working manually on consumer device.
3. **Consumer-only** — doesn't need to handle directory-source (dev machine) installs.
4. **Also fix the version sync** — pre-commit hook needs to bump both `marketplace.json` and `plugin.json`, since the marketplace version keys the cache directory.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `claude plugin install` changes behavior in a future release | Medium | Uses only public CLI commands and git. Skill prints clear errors on failure. |
| Marketplace clone path varies by system | Low | Read from `known_marketplaces.json` dynamically. |
| Consumer hasn't added the marketplace | Low | Detect and tell them to run the full add + install sequence. |

## Progress
- [x] Phase 1: Fix version sync in pre-commit hook
- [x] Phase 2: Create the update skill
- [x] Phase 3: Update README

---

## Phase 1: Fix version sync in pre-commit hook

The pre-commit hook currently only bumps `oddkit/.claude-plugin/plugin.json`. But the consumer's cache directory is keyed to the marketplace.json version. Both need to stay in sync.

### Step 1.1: Update `hooks/pre-commit` to bump both files

Modify the hook to also bump the version in `.claude-plugin/marketplace.json` (the `plugins[0].version` field). Also bump `marketplace.json` to `0.2.0` now to fix the existing mismatch.

**Files:** `hooks/pre-commit`, `.claude-plugin/marketplace.json`

**Verify:** Make a test commit touching an `oddkit/` file and confirm both versions increment together.

---

## Phase 2: Create the update skill

### Step 2.1: Create `oddkit/skills/update/SKILL.md`

Follow existing skill patterns (frontmatter with name, description). The skill:

1. **Find the marketplace clone** — read `~/.claude/plugins/known_marketplaces.json`, find the oddkit entry, extract `installPath`.
2. **Pull latest** — `git -C <installPath> pull origin main`.
3. **Read new version** — parse `oddkit/.claude-plugin/plugin.json` from the updated clone to get the new version.
4. **Clear old cache** — `rm -rf ~/.claude/plugins/cache/oddkit/`.
5. **Reinstall** — run `claude plugin install oddkit@oddkit`.
6. **Report** — print old version → new version, tell user to restart Claude Code.

**Error handling:**
- If oddkit not found in `known_marketplaces.json`: tell user to run the full install sequence.
- If `git pull` fails: report the error (network, auth, etc.).
- If `claude plugin install` fails: report the error and suggest manual steps.

**Files:** `oddkit/skills/update/SKILL.md` (new)

**Verify:** Install on consumer device, run `/oddkit:update`, confirm new skills appear after restart.

---

## Phase 3: Update README

### Step 3.1: Update the "Update" section in README.md

Replace the current update instructions with `/oddkit:update` as the primary method. Keep the manual steps as a fallback.

**Files:** `README.md`

---

## Verification

1. On consumer device: run `/oddkit:update`
2. Restart Claude Code
3. Confirm new skills (`plan`, `skill-converter`, `update`) appear in skill list
4. Confirm new agents (`code-scout`, `impact-scout`) are available
