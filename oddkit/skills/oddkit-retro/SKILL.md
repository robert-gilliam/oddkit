---
name: oddkit-retro
description: >
  Retro the current session for friction caused by oddkit's own skills, then, if a fix would
  keep the problem from recurring, open a PR against the local oddkit repo improving the skill.
  Use when the user wants to reflect on how oddkit performed, says a skill fought them or took a
  wrong turn, mentions the same problem happening "over and over", or says /oddkit:oddkit-retro.
  Also trigger after a session that leaned on oddkit skills when the user asks "how did that go"
  or "can we make that smoother next time".
model: opus
---

# oddkit Retro

Look back at how oddkit's skills behaved this session, find friction that will recur, and fix it at the source — the skill files — so the next session does not hit the same wall. This is oddkit improving itself from real use.

Hold the line on oddkit's convention while you do it: skills earn their keep by staying compact. A retro that bloats a skill with a special-case caveat for every hiccup fails its own goal. The best fix is usually a sharper sentence, a corrected assumption, or one small guardrail — rarely a new section.

## What earns a PR

A finding is worth a fix only when all three hold:

- **An oddkit skill caused or worsened it.** A model slip unrelated to any skill's instructions is not an oddkit bug. Trace the friction to specific lines in a specific skill.
- **It generalizes.** It would recur in other sessions, not a one-off tied to this particular repo or prompt.
- **A small instruction change addresses it.** If the only "fix" is a large rewrite or a new feature, that is a separate conversation, not a retro PR.

If the session used no oddkit skills, or the friction was incidental, say so plainly and stop. A clean retro with no PR is a good outcome.

## Step 1 — Digest the session

```bash
python3 <skill-dir>/scripts/session_digest.py
```

With no argument it finds the live session transcript (newest under `~/.claude/projects/<project>/`). Pass an explicit `.jsonl` path if you already know it.

The digest gives you the deterministic signals: which oddkit skills ran, how the permission mode moved, tool errors, tool counts, worktree commands, writes into `.oddkit/`, and the list of user prompts. It points at the story; it does not tell it. Read the transcript around the interesting records — the turns bracketing each oddkit skill, the errors, the moments the mode changed — to see what actually happened.

Friction the developer hits often, worth looking for specifically:

- **Permission-mode churn** — a skill assumed auto/bypass and got blocked mid-flow, or paused to ask when the mode meant it should not.
- **Worktree isolation** — a skill switched branches instead of using a worktree, collided on a worktree path that already existed, or left worktrees behind.
- **Writing into the project's `.oddkit/`** — files landed there that should not have, or path confusion about where skill state belongs.
- **Backtracking** — repeated failing commands, re-reading the same files, or a wrong assumption the skill led with that had to be undone.
- **User corrections** — anywhere the developer redirected the skill ("no, use a worktree", "stop writing there"). A correction is the strongest signal a skill's instructions were unclear.

## Step 2 — Diagnose

For each surviving finding, name the skill, the file, the lines, and what the instruction should say instead. The session ran the *installed* skills; you edit the *source* in `~/Development/oddkit/oddkit/skills/<name>/`. Same skills — the local repo is the source of truth. Before proposing an edit, open the current source and confirm the lines still read as they did in the session; if the source has already moved on, the fix may be moot.

Drop anything that fails the bar in "What earns a PR". Be strict. One sharp fix beats five speculative ones.

## Step 3 — Present, then get the go-ahead

If nothing qualifies, report the clean bill and stop here.

Otherwise show the developer, tightly:

- Each finding: the friction, the session signal that proves it, and the skill it maps to.
- The exact edit you propose, as a before/after.

Then ask: **"Open a PR against oddkit with these? You can drop or adjust any."** Wait for a yes. This gate is required — never push a PR to the oddkit repo without it.

## Step 4 — Open the PR (only after a yes)

Work on a worktree of the oddkit repo. Never edit on the developer's current branch, and never touch the installed plugin cache.

```bash
ODDKIT=~/Development/oddkit
git -C "$ODDKIT" fetch origin main
WT="$ODDKIT/.oddkit/worktrees/oddkit-retro"   # append -2, -3 if the path exists
git -C "$ODDKIT" worktree add "$WT" -b retro/<short-slug> origin/main
```

`.oddkit/` is gitignored, so the worktree never pollutes the repo — that is why it lives there. Apply the approved edits inside `$WT` with `git -C "$WT"` or by pathing into it; keep each diff minimal. Commit with the co-author trailer, push, and open the PR against `main`:

```
git -C "$WT" add -A
git -C "$WT" commit -m "$(cat <<'EOF'
fix(<skill>): <one-line friction fixed>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git -C "$WT" push -u origin retro/<short-slug>
(cd "$WT" && gh pr create --base main --head retro/<short-slug> --title "..." --body "...")
```

`gh` reads the repo from its working directory, so run it from `$WT`.

PR body, brief: the friction, the session signal behind it, what changed, and why it generalizes. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Remove the worktree once the PR is open (`git -C "$ODDKIT" worktree remove --force "$WT"`), and report the PR URL.

Scope one PR to this retro's findings. Resist folding in unrelated cleanups — that is a different task.
