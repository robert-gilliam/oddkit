---
name: autopilot
description: >
  Resolve one or more GitHub issues end-to-end with no human in the loop. Triages each
  issue from its full thread plus a recon pass, decides every reversible ambiguity itself
  and posts the decisions as a brief, hands off to /oddkit:one-shot (which reviews its plan
  before coding), vets the PR in a fresh agent, runs review-and-fix only when the vet flags
  something, drives CI green, and with --yolo merges. Stops for a human only when a decision
  is user-visible, has no precedent, and is expensive to reverse; then it posts the
  questions on the issue and writes burndown-plan files instead of asking in the terminal.
  Use whenever the developer hands over GitHub issues to be resolved hands-off: "autopilot
  #12", "resolve #12 and #14 without asking me", "take these issues all the way to merge",
  "run the issue pipeline on #30", "work through these issues overnight", or
  "/oddkit:autopilot". Pick this over /oddkit:one-shot when the input is issue numbers,
  and over /oddkit:burndown-ship when the issues have not been through burndown-plan.
argument-hint: "<#issue ...> [--yolo]"
model: opus
---

# Autopilot

Carry GitHub issues from "someone filed this" to "merged" without a human in the loop.
One issue or many. The skill is glue: it sequences `oddkit:one-shot`, `oddkit:vet-prs`,
`oddkit:review-and-fix`, and (rarely) `oddkit:burndown-plan`, and adds the three things
none of them has: a triage gate that decides when a human is genuinely required, a vet
gate that keeps the expensive review loop for PRs that need it, and a stop protocol that
leaves a comment instead of a hanging question.

**The autonomy contract.** You never ask the developer anything in the terminal. Every
ambiguity is resolved from the thread, the code, and sensible defaults, then written down
where a human can object later (the brief on the issue, the PR body). The only reason to
stop is the **needs-human test** below, or a sub-skill reporting it cannot finish. Both
end in a comment on the issue, never in a question. Someone reads the comment later.

**Invoke sub-skills by their full `oddkit:` name** through the `Skill` tool:
`oddkit:one-shot`, `oddkit:vet-prs`, `oddkit:review-and-fix`, `oddkit:burndown-plan`.
Project-local skills (`create-issue`, `enrich-issue`, `sync-issues`) go by bare name.

**You are the orchestrator.** A sub-skill loaded with `Skill` runs inside this
conversation. When its instructions end, the next phase here is still yours. Don't end
the turn after one-shot prints its summary; the vet gate is next.

**Shell rule:** never combine `cd` and `git` in one compound command. Use `git -C <path>`.

## Parse arguments

From `$ARGUMENTS`:
- **Issue refs** (one or more): `#\d+`, bare numbers, or issue URLs. Required. With
  none, ask once ("Which issues?") and proceed. That is missing input, not a question
  about the work.
- **`--yolo`**: merge each PR that reaches merge-ready. Without it, PRs are left open and
  merge-ready. Nothing else changes; the pipeline is fully autonomous either way.

One ref → **single mode**, the rest of this file in order. Two or more → **batch mode**
(see the Batch mode section): fan out single mode per issue, then merge serially.

Echo the resolved plan in one line: `Autopilot: #12 #14 · merge: yes · base: main`.

## Phase 0 — Preflight

```bash
MAIN_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
git -C "$MAIN_REPO" fetch origin --prune
gh repo view --json owner,name >/dev/null \
  || { echo "Not in a GitHub repo (or gh not authenticated). Aborting."; exit 1; }
BASE_BRANCH=$(git -C "$MAIN_REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||')
```

Fall back to `main`, then `master`; verify `origin/$BASE_BRANCH` exists.

Detect project-local skills once and remember the result:

```bash
for s in create-issue enrich-issue sync-issues; do
  f="$MAIN_REPO/.claude/skills/$s/SKILL.md"
  if [ -f "$f" ]; then
    grep -q -- '--yolo' "$f" && echo "$s: yolo" || echo "$s: no-yolo"
  else echo "$s: absent"; fi
done
```

A project skill is used only when it is present **and** accepts `--yolo` (the
argument-hint or body mentions it). A project skill without `--yolo` would stop to ask,
which breaks the run, so fall back to the built-in version in `references/fallbacks.md`
and say so in the summary. Project skills are the project's conventions; the fallbacks
are ours. `sync-issues` takes no flag and is always used when present.

Create one task per phase so you don't stop early.

## Phase 1 — Triage

Triage answers one question per issue: can this be resolved without a human, and if so,
what exactly is "done"? It reads the thread, runs recon, and ends in one of five
outcomes. Everything downstream keys off the outcome, so be deliberate here.

### 1a. Read the whole thread

```bash
gh issue view <n> --json number,title,body,state,url,comments,labels
```

Closed → outcome **skip**; note it, move on. Otherwise read the body and **every
comment** in order. Later comments override the body. Specifically look for:

- A prior autopilot questions comment (marker `<!-- oddkit:autopilot-questions -->`).
  If one exists, the comments after it are the answers. Treat a human reply as settling
  those questions. If there is no reply yet, this issue is still waiting: outcome
  **needs human**, but don't post the questions again (see 2c).
- A prior brief (`<!-- agent-brief -->`). Its resolved scope is a strong prior, not a
  verdict; re-check it against newer comments.
- Statements that change the ask, and disagreements nobody resolved.
- Links, screenshots, and referenced PRs or issues. Read linked issues if the ask
  depends on them.

### 1b. Recon

Set up a read-only recon worktree pinned to fresh base, exactly as one-shot does
(`.oddkit/worktrees/autopilot-recon-<n>`), and spawn `@oddkit:code-scout` and
`@oddkit:impact-scout` (`model: sonnet`) in one message with the issue title, body, and
resolved thread. Ask code-scout for the one or more places the work lands and the
pattern to follow; ask impact-scout for blast radius and for evidence if the behavior
already exists. Remove the worktree when both return.

### 1c. Write the done-sentence and list the decisions

Write one sentence of the form **"When <trigger>, <system> should <observable
outcome>."** that you would bet the issue author accepts. Then list every decision you
had to make to get there, however small, with the option you picked and why. Those lists
drive the outcome.

### 1d. The needs-human test

A single decision needs a human only when **all three** hold:

1. **Visible outside the code.** It changes behavior, data, a contract, money,
   permissions, or what gets deleted. Internal choices never qualify: naming, file
   placement, which of two equivalent patterns, test layout, an easily changed default.
2. **No precedent.** Nothing in the thread, the codebase, its tests, docs, or conventions
   tips it. If a sibling feature already made this choice, follow it; that is precedent.
3. **Expensive to reverse.** A migration, a public API, an external integration,
   destroyed data, or behavior a user would report as a bug rather than as missing
   polish.

Reversible or precedented decisions are yours to make, no matter how many there are.
Make them, list them, move on. There is no cap on assumptions; volume is not ambiguity.
There is also no category that stops on its own (auth, billing, schema changes). The
test is the test, and the vet and review gates catch the rest.

Examples:

| Situation | Outcome | Why |
|---|---|---|
| "Remove inactive accounts." No hard- vs soft-delete stated, no delete pattern in the codebase. | needs human | Visible, unprecedented, destroys data. |
| "Add a date filter." No default range stated, none elsewhere. | decided | Pick last 30 days; a default is cheap to change. |
| "Add CSV export." Format details unstated; a JSON exporter exists. | decided | Follow the exporter's shape. Precedent. |
| Author asks for a modal; a teammate replies "should be a page", no reply. Codebase uses pages for every edit flow. | decided | Precedent resolves the disagreement. Say so in the brief. |
| Same disagreement, codebase has both patterns equally. | needs human | Visible, no precedent, reworking a UI flow is costly. |
| Title only: "Login page flashes before redirect." Recon finds one redirect in one component. | decided | One target, one observable outcome. Write the criteria. |
| Title only, recon finds three plausible places or none. | needs human | No done-sentence you'd bet on. |
| Error message wording, button label, sort order of a list. | decided | Internal or trivially reversible. Always your call. |

### 1e. Outcomes

| Outcome | Condition | Next |
|---|---|---|
| **skip** | issue closed | note in summary |
| **already done** | recon shows the behavior implemented, with 1–3 `file:line` of evidence; be conservative, partial coverage is not done | 2a |
| **clear** | done-sentence written, zero decisions needed, nothing in the thread changed the ask | 2d |
| **decided** | done-sentence written; you made at least one decision, resolved a disagreement via precedent, or the comments changed the ask | 2b then 2d |
| **needs human** | any decision fails the needs-human test, a disagreement precedent can't settle, a thin issue with zero or several targets, or no done-sentence you'd bet on | 2c, stop |

Also mark, independently of outcome, whether the issue contains a **manual step inside
scope**: something a person must do that the code can't (set a production secret,
register a webhook in a vendor dashboard, create a template in a third-party tool).
This never stops the run. It files one follow-up (Phase 6) and blocks a `--yolo` merge
unless the code is a safe no-op until the step is done.

## Phase 2 — Act on the outcome

### 2a. Already done

Post the "already complete" comment from `references/comments.md` with the evidence.
No PR. Terminal for this issue.

### 2b. Decided → post the brief

The brief is the trail: the resolved scope, what the thread changed, and the
assumptions you are about to build on. Post it only for **decided** issues; clear
issues get no comment, and the PR body carries any notes.

- Project `enrich-issue` present with `--yolo` → `Skill(skill: "enrich-issue", args:
  "<n> --yolo")`. Hand it your done-sentence and decision list so the brief states them.
- Otherwise → write the brief yourself with the template in `references/fallbacks.md`
  (marker `<!-- agent-brief -->`, upsert so a re-run edits rather than duplicates).

The brief becomes part of the issue thread, so vet-prs grades intent against your
resolved scope rather than the raw body.

### 2c. Needs human → questions, then stop

Two places, so the answer works for whoever sees it first:

1. `Skill(skill: "oddkit:burndown-plan", args: "#<n>")`. It writes the local tracking
   and clarifying-questions files under `.oddkit/`, so `/oddkit:burndown-implement`
   remains a valid way to continue. Its own question criterion is the same needs-human
   test.
2. Post the questions comment from `references/comments.md`: only the questions that
   failed the test, multiple choice, your recommendation marked on each. If
   burndown-plan wrote a clarifications file, its questions are the source; if it decided
   no file was needed, use your own list from 1c. Marker:
   `<!-- oddkit:autopilot-questions -->`.

If a questions comment already exists and has no human reply (from 1a), post nothing
new; the issue is waiting. Record **stopped: awaiting answers** and move on.

Then stop for this issue. On the next run, 1a finds the answers in the thread, you fill
the matching `[Answer]:` lines in the local clarifications file (if it still exists) so
the two channels agree, and the issue goes through 2b with the answers as decisions.

### 2d. Clear or decided → one-shot

```
Skill(skill: "oddkit:one-shot", args: "#<n> --unattended")
```

Never pass `--with-review` (the vet gate decides that) or `--yolo` (merging is Phase 5,
and in batch mode merges are serialized). `--unattended` makes one-shot's emergency
protocol post a comment and stop instead of asking.

Pass your triage along: the done-sentence and the decision list are part of the spec, so
the implementer builds what you decided and the PR body lists it. one-shot recons again,
classifies simple vs complex, and for complex work writes a plan, reviews it, fixes it,
then implements. Read its result:

- **Merge-ready, CI green** → Phase 3.
- **PR open, CI red after 3 rounds** → stop comment, reason `ci`. Leave the PR open.
- **Failed** → stop comment, reason `implementation failed`, with the worktree path.
- **Stopped (emergency)** → one-shot already commented. Record it and move on.

## Phase 3 — Vet gate, in a fresh agent

The agent that wrote the code must not grade it. vet-prs already uses a separate
grading agent, but the orchestrator holding the plan and the implementer's summary is
still a bias when it reads the result. Keep the whole thing out of this context:

```
Agent(subagent_type: "general-purpose", model: "sonnet", prompt:
  "Invoke the Skill tool with skill `oddkit:vet-prs` and args `<PR_NUMBER> --yolo`.
   Follow it to completion. Read nothing else first. Reply with the single line
   `scope=<S|M|L> intent=<✓|⚠️|✗> smell=<clean|iffy|red>` taken from
   .oddkit/vet-prs/<PR_NUMBER>.json.")
```

Read the verdict from that file, not from memory. If the file is missing, treat it as
`iffy` and continue to Phase 4; a missing vet never skips review.

```
if smell == "clean" and intent == "✓":  → Phase 5 (merge gate)
else:                                   → Phase 4 (review and fix)
```

## Phase 4 — Review and fix, in a fresh agent

Same isolation, deeper loop:

```
Agent(subagent_type: "general-purpose", prompt:
  "Invoke the Skill tool with skill `oddkit:review-and-fix` and args `#<PR_NUMBER>`.
   Follow it to completion. Read nothing else first. Reply with the verdict it posted
   (`Ready to merge`, `Fix then merge`, or `Needs reworking`), the tests result, and
   any follow-up issue numbers it created.")
```

review-and-fix reviews against the source issue, fixes every real finding in place,
loops until clean (cap 3), runs the tests, and posts the review trail. There is no
second vet after it; its verdict is the second check:

| Verdict | Meaning | Action |
|---|---|---|
| Ready to merge | everything fixed, tests pass, no open requirement | Phase 5 |
| Fix then merge | fixes landed, but human eyes on the diff are warranted | post the "PR open, needs eyes" comment on the issue; no merge even with `--yolo`; terminal |
| Needs reworking | unmet requirement, failing tests, or the loop hit its cap | stop comment, reason `review`; no merge; terminal |

Because review-and-fix pushed commits, CI ran again. Before Phase 5 re-check it with
one-shot's Phase 5 procedure (watch, read the snapshot, fix with a sonnet agent, cap 3
rounds). Red after 3 → stop comment, reason `ci`.

## Phase 5 — Merge gate

Merge-eligible means all of: `--yolo` was passed, the vet came back clean or
review-and-fix said Ready to merge, CI is green (or no checks are configured; say so),
and the issue has no manual step in scope whose absence makes the code unsafe. Then:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

Follow the repo's merge style if it clearly differs. A blocked merge (branch protection,
required reviews, not mergeable) is a reporting outcome: leave the PR open, say why.

Not merge-eligible → leave the PR open and merge-ready. In batch mode, don't merge here
at all; return `merge_eligible: yes|no (<reason>)` and let the orchestrator do it.

## Phase 6 — Follow-ups and sync

**Follow-up issues are rare.** File one only for a manual step inside scope (Phase 1)
or when review-and-fix reported a last-resort piece it could not finish. Never for
"nice to have" work the issue didn't ask for, and never to punt something doable. One
issue per autopilot run per source issue, listing every manual step together.

- Project `create-issue` present with `--yolo` → `Skill(skill: "create-issue", args:
  "<description> --yolo")`.
- Otherwise → the fallback in `references/fallbacks.md`.

Link it from the PR body ("Inert until #<f> is done") and from the summary.

If a project `sync-issues` skill exists, `Skill(skill: "sync-issues", args: "<n>")` once
the issue reaches a terminal state. Best-effort; a sync failure changes nothing.

## Phase 7 — Summary

Per issue, one block. In single mode print it; in batch mode return it to the
orchestrator.

```
### #<n> — <title>
Outcome: <merged | merge-ready | needs eyes | stopped: <reason> | already done | skipped>
Triage:  <clear | decided (<k> decisions, brief posted) | needs human (<k> questions)>
PR:      <url> · vet <S/✓/clean> · review <skipped | Ready to merge | …> · CI <green|red|none>
Follow-up: <#f (manual steps)> | none
merge_eligible: <yes | no (<reason>)>
```

Clean up recon worktrees you created. Leave one-shot's worktrees from a failure or
emergency in place and name them.

## Batch mode

Two or more issue refs. Each issue is independent; one stopping never touches another.

1. Preflight once.
2. Spawn one agent per issue, all in one message:
   ```
   Agent(subagent_type: "general-purpose", prompt:
     "Invoke the Skill tool with skill `oddkit:autopilot` and args `#<n>` (no --yolo).
      Follow it to completion. Reply with its summary block verbatim.")
   ```
   Triage, implementation, vet, review, and CI all run in parallel this way, with
   per-issue worktrees that one-shot already manages.
3. Collect the blocks. Without `--yolo`, print them and finish.
4. With `--yolo`, merge serially in **input order**, only the blocks with
   `merge_eligible: yes`. For each: if the PR is behind the base (an earlier merge moved
   it), `gh pr update-branch <PR>`, wait for CI once with the Phase 4 procedure, then
   merge. A branch that conflicts on update stays open with the "PR open, needs eyes"
   comment, reason `conflicts with #<earlier>`. Later PRs continue.

   Serial merging is what makes overlapping issues safe: conflicts show up exactly at
   merge time instead of being guessed from recon.
5. Print all blocks plus one line per merge decision.

## Stop protocol

Every stop is the same comment, posted on the **issue** (the thing a human will look
at), from `references/comments.md`, marker `<!-- oddkit:autopilot-stop -->`. It names the
reason (one of `needs human`, `awaiting answers`, `emergency: <kind>`, `implementation
failed`, `review`, `ci`), what exists (PR, branch, worktree, nothing), and the exact next
step to resume. Reasons are a closed list so the summary and any later tooling can
count them.

Stopping is per issue. In single mode the run ends; in batch mode the other issues
keep going.

## Notes for the implementer

- **Decide, don't ask.** If you are drafting a terminal question, re-read the
  needs-human test. Almost everything fails it. Decide and write it in the brief.
- **Clear issues stay quiet.** A brief on an issue that needed no decisions is noise.
- **Fresh agents for every grade.** Phase 3 and 4 run inside agents whose only
  instruction is the skill invocation. Never run vet-prs or review-and-fix inline here.
- **The verdicts come from disk and from GitHub**, not from what you remember writing.
- **Follow-ups are for manual steps**, not for scope you'd like to add.
- **Don't stop after a sub-skill returns.** one-shot's summary, burndown-plan's handoff,
  and a wrapper agent's reply are all mid-run. The next phase is yours.
