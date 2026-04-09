---
name: eval
description: >
  Run the same task through multiple models, configs, or approaches and compare the results.
  Creates isolated git worktrees per variant, runs everything in parallel, then grades, benchmarks,
  and opens an interactive HTML viewer with rubric scores, comparison matrices, and timing data.
  Use when the user wants to compare models, compare approaches, A/B test implementations, evaluate
  plans across configs, benchmark model performance, or says /oddkit:eval. Also trigger when the user
  says "compare these approaches", "which model is better for this", "run this with and without
  ultrathink", "test opus vs sonnet", "evaluate three versions", or any request involving side-by-side
  comparison of AI-generated work products.
argument-hint: "<natural language task with variant descriptions>"
model: opus
---

# Eval

Run the same task through multiple variants — different models, thinking modes, or configurations —
and compare the results. Each variant runs in an isolated git worktree on its own branch. Results
are graded, benchmarked, and presented in an interactive HTML viewer.

The user describes everything in natural language. Your job is to parse the task and variants,
set up isolation, run the work, and evaluate the outputs.

**Shell rule:** Never combine `cd` and `git` in a single compound bash command. Run them as
separate tool calls, or use `git -C <path>`.

## Step 1 — Parse the prompt

Extract from the user's natural language `$ARGUMENTS`:

- **Task**: what work to perform (e.g., "create an implementation plan for X", "implement this plan")
- **Variants**: the configurations to compare (e.g., "opus with ultrathink", "codex 5.4", "gemini 3.1 pro")
- **Iteration**: if this is a re-run, the user may reference a previous eval workspace

### Variant parsing

Each variant has:
- **CLI**: which tool to invoke — `claude`, `codex`, or `gemini`
- **Model** (optional): specific model ID to pass
- **Thinking mode** (optional): ultrathink/extended thinking on or off
- **Label**: a short slug for branch names and directory names (e.g., `opus-ultrathink`, `codex-5.4`, `gemini-3.1-pro`)

Map natural language to CLI invocations:

| User says | CLI | Flags |
|-----------|-----|-------|
| "claude opus 4.6" or just "opus" | `claude` | `--model claude-opus-4-6` |
| "claude sonnet 4.6" or just "sonnet" | `claude` | `--model claude-sonnet-4-6` |
| "opus with ultrathink" or "opus with extended thinking" | `claude` | `--model claude-opus-4-6 --effort max` |
| "opus without ultrathink" | `claude` | `--model claude-opus-4-6 --effort high` |
| "codex" or "codex 5.4" | `codex` | (default model) |
| "gemini" or "gemini 3.1 pro" | `gemini` | (default model) |

For model IDs, accept fuzzy input. "opus 4.6" means `claude-opus-4-6`. "sonnet" means `claude-sonnet-4-6`.
If the user specifies a model you don't recognize, use it as-is (they may know a model ID you don't).

If no variants are specified, ask: "What variants should I compare?"

Confirm your parsing with the user before proceeding:

```
## Eval Setup

**Task:** <parsed task>
**Variants:**
1. <label> — <cli> <flags>
2. <label> — <cli> <flags>

Look right?
```

Wait for confirmation unless the user said to just run it.

## Step 2 — Set up workspace and worktrees

### Workspace

Determine the eval name from the task (short kebab-case slug). Create the workspace:

```
eval-workspace/<eval-name>-<YYYY-MM-DD>/
├── iteration-1/
│   ├── eval-0/                          # one "eval" directory for the task
│   │   ├── eval_metadata.json
│   │   ├── <variant-1-label>/           # one directory per variant
│   │   │   └── run-1/                   # run directory (supports multiple runs)
│   │   │       ├── outputs/
│   │   │       ├── grading.json
│   │   │       └── timing.json
│   │   ├── <variant-2-label>/
│   │   │   └── run-1/
│   │   │       ├── outputs/
│   │   │       ├── grading.json
│   │   │       └── timing.json
│   ├── benchmark.json
│   ├── benchmark.md
│   └── feedback.json
```

This structure matches the aggregation script's expectations: `eval-*/config/run-*/grading.json`.

Write `eval_metadata.json` inside the `eval-0/` directory:
```json
{
  "eval_id": 0,
  "eval_name": "<eval-name>",
  "prompt": "<the full task prompt>",
  "variants": [
    {"label": "<label>", "cli": "<cli>", "flags": "<flags>"}
  ],
  "assertions": [],
  "timestamp": "<ISO timestamp>",
  "iteration": 1
}
```

### Worktrees

For each variant, create an isolated git worktree and branch:

```bash
git worktree add -b eval/<eval-name>/<variant-label> <worktree-path> HEAD
```

The worktree path should be a temporary location outside the main repo:

```bash
/tmp/oddkit-eval/<eval-name>/<variant-label>
```

Use `/tmp` for worktrees to keep the project directory clean — only results land in `eval-workspace/`.

## Step 3 — Run all variants in parallel

Spawn one subagent per variant **in the same turn** — all variants must launch simultaneously.
Use `mode: "bypassPermissions"` on every Agent call so evals don't stall on permission prompts.
Run them in the background so you can draft assertions while they execute.

### Claude variant

```
Execute this task in the worktree at <worktree-path>:

Task: <the task prompt>

Work entirely within this directory. Save all meaningful output files to:
<workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/

When done, write a brief summary of what you produced to:
<workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/summary.md
```

Invoke via the Agent tool with `model` set appropriately.
For ultrathink variants, include in the prompt: "Use extended thinking. Think deeply and thoroughly."
For non-ultrathink variants, include: "Work efficiently and directly."

### Codex variant

Codex uses a different CLI. Invoke via Bash:

```bash
cd <worktree-path> && codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  -C <worktree-path> \
  "<task prompt>

Save all meaningful output files to: <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/
When done, write a brief summary to: <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/summary.md" \
  2>&1 | tee <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/transcript.md
```

Run in background via the Bash tool with `run_in_background: true`.

### Gemini variant

Gemini uses its own CLI. Invoke via Bash:

```bash
cd <worktree-path> && gemini \
  --yolo \
  -p "<task prompt>

Save all meaningful output files to: <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/
When done, write a brief summary to: <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/outputs/summary.md" \
  2>&1 | tee <workspace>/iteration-<N>/eval-0/<variant-label>/run-1/transcript.md
```

Run in background via the Bash tool with `run_in_background: true`.

## Step 4 — Draft assertions while variants run

While the variants execute in the background, draft quantitative assertions for the eval.
Good assertions are objectively verifiable and have descriptive names.

Think about what matters for this specific task:
- **For plans**: Does it have phases? Are file paths concrete? Are acceptance criteria present? Is it actionable?
- **For implementations**: Does it compile/pass linting? Do tests pass? Are the specified files created? Does the code follow conventions?
- **For general tasks**: Does the output exist? Is it the right format? Does it contain required elements?

Write assertions to `eval-metadata.json` (update the existing file):
```json
{
  "assertions": [
    "The output file exists and is non-empty",
    "The plan includes concrete file paths, not vague references",
    "Acceptance criteria are present and testable"
  ]
}
```

Explain the assertions to the user while waiting:
"While the variants run, here are the assertions I'll grade against: ..."

## Step 5 — Capture timing data

As each variant completes (via task notification or background process completion), immediately
capture timing data. This is the only opportunity — the data isn't persisted elsewhere.

Save to `<workspace>/iteration-<N>/eval-0/<variant-label>/run-1/timing.json`:
```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

For Bash-invoked CLIs (codex, gemini), measure wall-clock time from the bash command duration.
Token counts may not be available for non-Claude CLIs — record 0 if unavailable.

## Step 6 — Grade each variant

Once all variants complete:

For each variant, spawn a grader subagent with `mode: "bypassPermissions"`. Read
`${CLAUDE_SKILL_DIR}/agents/grader.md` for the full grader protocol. Key inputs:

- **expectations**: the assertions from Step 4
- **transcript_path**: path to transcript.md (if available) or summary.md
- **outputs_dir**: path to the variant's outputs/ directory

Save results to `<variant-label>/run-1/grading.json`.

Launch all graders in parallel in the same turn.

## Step 7 — Blind comparison

For each pair of variants, spawn a blind comparator subagent with `mode: "bypassPermissions"`.
Read `${CLAUDE_SKILL_DIR}/agents/comparator.md` for the full protocol.

The comparator receives two outputs labeled A and B without knowing which variant produced which.
It scores both on the content rubric (correctness, completeness, accuracy — each 1-5) and the
structure rubric (organization, formatting, usability — each 1-5), then picks a winner.

For 2 variants: 1 comparison (A vs B).
For 3 variants: 3 comparisons (A vs B, A vs C, B vs C).
For 4+ variants: compare all pairs.

Randomly assign A/B labels to prevent position bias. Record the mapping so you can unblind later.

Save each comparison to `<workspace>/iteration-<N>/comparison-<labelA>-vs-<labelB>.json`.

## Step 8 — Aggregate benchmark

After grading completes, run the benchmark aggregation script:

```bash
python ${CLAUDE_SKILL_DIR}/scripts/aggregate_benchmark.py \
  <workspace>/iteration-<N> \
  --skill-name "<eval-name>"
```

This produces `benchmark.json` and `benchmark.md` with pass_rate, time, and tokens for each
variant, including mean, stddev, and deltas.

## Step 9 — Analyst pass

Spawn an analyzer subagent with `mode: "bypassPermissions"`. Read
`${CLAUDE_SKILL_DIR}/agents/analyzer.md` (the "Analyzing Benchmark Results" section).

The analyzer reads `benchmark.json` and surfaces patterns the aggregate stats might hide:
- Assertions that always pass regardless of variant (non-discriminating)
- High-variance results (possibly flaky)
- Time/token tradeoffs
- Surprising results that contradict expectations

The analyzer writes notes as a JSON array of strings. Merge these into `benchmark.json`'s `notes` field.

## Step 10 — Launch the viewer

Generate and serve the interactive HTML viewer:

```bash
nohup python ${CLAUDE_SKILL_DIR}/eval-viewer/generate_review.py \
  <workspace>/iteration-<N> \
  --skill-name "<eval-name>" \
  --benchmark <workspace>/iteration-<N>/benchmark.json \
  > /dev/null 2>&1 &
VIEWER_PID=$!
```

For iteration 2+, also pass `--previous-workspace <workspace>/iteration-<N-1>`.

Tell the user:
"Results are open in your browser. Two tabs — 'Outputs' lets you compare each variant's work
and leave feedback, 'Benchmark' shows the quantitative comparison. Come back here when you're done."

### What the user sees

**Outputs tab**: one eval at a time. For each variant:
- The task prompt
- Output files rendered inline
- Blind comparison scores (if available)
- Grading results (collapsed)
- Feedback textbox (auto-saves)

**Benchmark tab**: summary table with pass rates, timing, and token usage per variant.
Per-assertion breakdowns. Analyst observations.

## Step 11 — Read feedback and iterate

When the user returns, read `feedback.json`:

```json
{
  "reviews": [
    {"run_id": "variant-label", "feedback": "...", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means the user thought it was fine.

Kill the viewer:
```bash
kill $VIEWER_PID 2>/dev/null
```

### If the user wants to iterate

1. Adjust the task prompt or assertions based on feedback
2. Create `iteration-<N+1>/` in the same workspace
3. Set up fresh worktrees (reuse branches or create new ones)
4. Rerun all variants
5. Launch the viewer with `--previous-workspace` pointing at the previous iteration
6. Repeat until the user is satisfied

### If the user is done

Report the final results:

```
## Eval Complete — <eval-name>

**Variants tested:** <list>
**Winner:** <variant with highest overall score>

### Scores
| Variant | Pass Rate | Time | Tokens | Overall |
|---------|-----------|------|--------|---------|
| <each variant's stats> |

### Key Findings
<analyst notes, comparison highlights>

### Branches
<list of persistent branches for each variant>

To continue from the winning variant:
  git checkout eval/<eval-name>/<winner-label>
```

## Cleanup

Worktrees in `/tmp/oddkit-eval/` can be cleaned up:
```bash
git worktree remove <worktree-path>
```

But do NOT delete the branches or the workspace. The user chose persistent branches so they can
inspect and cherry-pick. Only clean up worktrees (the working directories), not branches.

## Reference files

Agents and scripts bundled with this skill:

- `agents/grader.md` — evaluates assertions against outputs and transcripts
- `agents/comparator.md` — blind head-to-head comparison of two outputs
- `agents/analyzer.md` — surfaces patterns in benchmark data
- `scripts/aggregate_benchmark.py` — aggregates grading results into benchmark stats
- `eval-viewer/generate_review.py` — generates and serves the interactive HTML review viewer
- `eval-viewer/viewer.html` — the HTML template for the viewer
- `references/schemas.md` — JSON schemas for all data files (grading, benchmark, comparison, etc.)
