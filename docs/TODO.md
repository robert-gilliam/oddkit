# oddkit — To-Do List

Status key: `[ ]` not started, `[~]` in progress, `[x]` done

---

## 1. Gain Clarity on Purpose

- [x] Define the core problem (packaging scattered workflow skills into a portable collection)
- [x] Decide audience (personal now, public later)
- [x] One-sentence mission: "A growing toolkit of workflow skills for Claude Code."
- [~] Plugin name ("oddkit" — leaning keep, open to alternatives)

## 2. Branding Strategy

- [x] Run brand strategy session — lightweight brief written to `docs/brand/strategy.md`
- [x] Define voice principles (concise, human, no LLM cliches, no fluff)
- [x] Decision: build first, brand catches up. "odd" is a working direction, not a commitment.

## 3. Define Plugin Architecture

- [x] Research 10+ plugins — findings in `docs/research-architecture.md`
- [x] Follow canonical structure (skills/, agents/, .claude-plugin/plugin.json)
- [x] Minimal manifest created
- [x] Skills are primary building block, agents for isolation/parallel work
- [x] 7 shared agents in `agents/`, referenced by skills

## 4. Design Invocation Strategy

- [x] Research invocation patterns across plugins
- [x] Two skills: `review` and `address-feedback`
- [x] `review`: no args = local, PR number = GitHub, `--yolo` = skip confirmation
- [x] `address-feedback`: PR number required, `--yolo` = skip confirmation
- [x] Auto-detect code vs plan content, pick right agents
- [x] Two autonomy levels: confirm (default) and `--yolo`

## 5. Import and Restructure Existing Skills

- [x] Merged pr-review + plan-pr-review + local-review → `review` skill
- [x] Adapted address-pr-feedback → `address-feedback` skill
- [x] Extracted 7 shared agents into `agents/`
- [x] All agents set to opus

## 6. Design Autonomy Controls

- [x] Two levels: confirm (default) and `--yolo`
- [x] Configured per-invocation via `--yolo` flag
- [x] Default: show summary, confirm before any GitHub action
- [x] Action boundaries: posting comments, pushing code, approving/requesting changes
- [ ] Test the autonomy flow end-to-end

## 7. Future Skills

Planned skills (not yet built):

- [ ] `create-pr` — gather diff, write description, open PR
- [x] `plan` — create an implementation plan from a spec or issue, or from scratch
- [ ] `implement` — execute a plan with verification checkpoints
- [ ] `commit` — smart commit with good message from staged changes
- [ ] `debug` — systematic debugging of a failing test or error
- [ ] `cleanup` — find dead code, stale branches, unused files
- [ ] `retro` — extract lessons from recently completed tasks, append reusable rules to CLAUDE.md with deduplication
- [ ] `skill-converter` — import an external skill and rewrite it as an oddkit skill (minimal, concise, no ceremony or AI fluff)
- [ ] `polish` — run `review` on the current (or specified) branch, fix blocking issues, repeat until clean, then run linting/tests/CI and fix failures until everything passes

## 8. Future-Proofing

- [ ] Document extension points

## 9. Testing & Validation

- [ ] Test `review` skill locally (no args)
- [ ] Test `review` skill on a real PR
- [ ] Test `address-feedback` on a real PR
- [ ] Test `--yolo` flag
- [ ] Test auto-detection of code vs plan content
- [ ] Verify agent output format and deduplication

---

*Living document. Updated as we go.*
