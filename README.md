<p align="center">
  <img src="assets/oddkit-title.png" alt="Oddkit" width="400" />
</p>

<p align="center">
  Odds and ends for agentic development.
</p>


- **Lightweight autonomous Claude Code skills to accelerate your workflow.**
- **Guardrails that serve the agent.** Rules exist to wrangle AI, not for ceremonial process.
- **Start small, build up.** Avoids premature architecture and overwrought frameworks.

## Install

```
claude plugin marketplace add robert-gilliam/oddkit
claude plugin install oddkit@oddkit
```

## Update

```
/oddkit:update
```

## Skills

| Skill | What it does |
|-------|-------------|
| `review` | Review code, plans, or PRs from local or remote branches. Auto-detects content type. Capable of autonomously posting reviews on GitHub. |
| `vet-prs` | Fast triage gate across a batch of open PRs. One Sonnet agent per PR grades scope, intent, and smell. Posts a short comment on each PR. Use before deep review when you have a pile. |
| `address-feedback` | Address PR review comments: fetch, evaluate, fix, and respond autonomously. |
| `plan` | Build an implementation plan through recon, Q&A, and stress-testing. |
| `implement` | Execute a plan phase by phase with compliance checks and verification. |
| `burndown-plan` + `burndown-implement` | Burn down a batch of GitHub issues. `plan` recons in parallel and writes clarifying-question files; answer them offline, then `implement` ships one worktree + one PR per issue. |
| `skill-converter` | Import an external skill and rewrite it as an oddkit skill (minimal, concise, no ceremony or AI fluff). |
| `update` | Pull the latest oddkit from GitHub and refresh the local cache. |

## Skill Details

**`review`** — Review code or plans. Auto-detects content type.

```
/oddkit:review                    # local self-review
/oddkit:review #42                # review a PR (confirm before posting)
/oddkit:review #42 --yolo         # review a PR (post without asking)
/oddkit:review docs/plans/foo.md  # review a single file (no diff, no GitHub)
```

**`vet-prs`** — Triage a batch of open PRs in parallel. Each PR gets three grades — Scope (S/M/L), Intent (✓/⚠️/✗), Smell (clean/iffy/red) — so you can pick which ones deserve a full `/oddkit:review`. Posts a short comment on each PR (upserts on re-run).

```
/oddkit:vet-prs                       # vet every open PR in the repo
/oddkit:vet-prs #12 #14 #19           # vet a specific list
/oddkit:vet-prs --yolo                # skip the post-comments confirmation
```

**`address-feedback`** — Address PR review comments: fetch, evaluate, fix, respond.

```
/oddkit:address-feedback #42          # confirm before push/reply
/oddkit:address-feedback #42 --yolo   # push and reply without asking
```

**`plan`** — Build an implementation plan: recon, Q&A, approach selection, stress-test, phased plan.

```
/oddkit:plan add caching to the API layer
/oddkit:plan --out docs/plans/caching.plan.md
```

**`implement`** — Execute an implementation plan phase by phase with compliance checks and verification.

```
/oddkit:implement docs/plans/caching.plan.md
/oddkit:implement docs/plans/caching.plan.md --yolo
/oddkit:implement                              # auto-finds .plan.md files
```

**`burndown-plan` + `burndown-implement`** — Burn down a batch of GitHub issues async. Run `plan` first to recon and produce per-issue clarifying-question files. Answer them in your editor. Run `implement` to ship: one worktree per issue, one PR per issue, no realtime questions. State lives in `.oddkit/` (gitignored, branch-independent). Fully resumable.

```
/oddkit:burndown-plan #123 #456 #789
  → answer questions in .oddkit/burndown-clarifying-questions/<n>.md
/oddkit:burndown-implement
```

```
/oddkit:burndown-plan --base develop #123 #456   # override the base branch
```

**`skill-converter`** — Convert external skills into oddkit skills. Analyzes methodology, asks just enough to gauge intent, produces a compact skill.

```
/oddkit:skill-converter path/to/skill/SKILL.md
/oddkit:skill-converter path/to/skill-directory/
```

**`update`** — Pull the latest oddkit from GitHub and refresh the local cache.

```
/oddkit:update
```

If that doesn't work, update manually:

```bash
cd ~/.claude/plugins/marketplaces/oddkit && git pull
rm -rf ~/.claude/plugins/cache/oddkit/
claude plugin install oddkit@oddkit
```


## Development

To work on oddkit locally, load the plugin directly from source instead of the cached marketplace version:

```bash
claude --plugin-dir /path/to/oddkit/oddkit
```

To make this permanent, add a shell alias:

```bash
# ~/.zshrc or ~/.bashrc
alias claude='claude --plugin-dir /path/to/oddkit/oddkit'
```

Changes take effect on next launch. Use `/reload-plugins` to pick up changes mid-session.
