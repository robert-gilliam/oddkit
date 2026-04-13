# JSON Schemas

This document defines the JSON schemas used by the eval skill.

---

## eval-metadata.json

Defines the eval configuration. Located at `<workspace>/iteration-<N>/eval-metadata.json`.

```json
{
  "eval_name": "plan-comparison",
  "prompt": "Create an implementation plan for adding CSV export to the dashboard",
  "variants": [
    {"label": "opus-ultrathink", "cli": "claude", "flags": "--model claude-opus-4-6 --effort max"},
    {"label": "opus", "cli": "claude", "flags": "--model claude-opus-4-6 --effort high"},
    {"label": "codex-5.4", "cli": "codex", "flags": ""}
  ],
  "assertions": [
    "The plan includes concrete file paths",
    "Acceptance criteria are present and testable",
    "Phases are sequenced with dependencies noted"
  ],
  "timestamp": "2026-04-09T14:30:00Z",
  "iteration": 1
}
```

**Fields:**
- `eval_name`: Short kebab-case name for the eval
- `prompt`: The task prompt given to all variants
- `variants[]`: List of variant configurations
  - `label`: Short slug used for directory and branch names
  - `cli`: Which CLI tool (`claude`, `codex`, `gemini`)
  - `flags`: CLI flags to pass
- `assertions`: List of verifiable expectations (added after initial setup)
- `timestamp`: ISO timestamp of when the eval started
- `iteration`: Iteration number (1-based)

---

## grading.json

Output from the grader agent. Located at `<variant-dir>/grading.json`.

```json
{
  "expectations": [
    {
      "text": "The plan includes concrete file paths",
      "passed": true,
      "evidence": "Found 12 specific file paths referenced across 4 phases"
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "execution_metrics": {
    "tool_calls": {
      "Read": 5,
      "Write": 2,
      "Bash": 8
    },
    "total_tool_calls": 15,
    "total_steps": 6,
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "The plan covers error handling",
      "type": "quality",
      "verified": true,
      "evidence": "Phase 3 Step 2 includes error handling for CSV generation failures"
    }
  ],
  "user_notes_summary": {
    "uncertainties": [],
    "needs_review": [],
    "workarounds": []
  },
  "eval_feedback": {
    "suggestions": [],
    "overall": "Assertions look solid."
  }
}
```

**Critical:** The aggregation script reads exact field names. Expectations must use `text`, `passed`, and `evidence` — not `name`/`met`/`details` or other variants.

---

## timing.json

Wall clock timing for a run. Located at `<variant-dir>/timing.json`.

**How to capture:** When a subagent task completes, the task notification includes `total_tokens` and `duration_ms`. Save these immediately — they are not persisted anywhere else.

For Bash-invoked CLIs (codex, gemini), measure wall-clock time from command duration. Token counts may not be available — record 0 if unknown.

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

---

## benchmark.json

Aggregated benchmark output. Located at `<workspace>/iteration-<N>/benchmark.json`.

```json
{
  "metadata": {
    "skill_name": "plan-comparison",
    "skill_path": "",
    "executor_model": "multiple",
    "analyzer_model": "claude-opus-4-6",
    "timestamp": "2026-04-09T14:30:00Z",
    "evals_run": ["plan-comparison"],
    "runs_per_configuration": 1
  },
  "runs": [
    {
      "eval_id": 0,
      "eval_name": "plan-comparison",
      "configuration": "opus-ultrathink",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": []
    }
  ],
  "run_summary": {
    "opus-ultrathink": {
      "pass_rate": {"mean": 0.85, "stddev": 0.0, "min": 0.85, "max": 0.85},
      "time_seconds": {"mean": 42.5, "stddev": 0.0, "min": 42.5, "max": 42.5},
      "tokens": {"mean": 3800, "stddev": 0, "min": 3800, "max": 3800}
    },
    "opus": {
      "pass_rate": {"mean": 0.71, "stddev": 0.0, "min": 0.71, "max": 0.71},
      "time_seconds": {"mean": 28.0, "stddev": 0.0, "min": 28.0, "max": 28.0},
      "tokens": {"mean": 2400, "stddev": 0, "min": 2400, "max": 2400}
    },
    "delta": {
      "pass_rate": "+0.14",
      "time_seconds": "+14.5",
      "tokens": "+1400"
    }
  },
  "notes": [
    "Opus with ultrathink spent 50% more time but scored higher on completeness",
    "Both variants passed structural assertions equally"
  ]
}
```

**Important:** The `configuration` field in each run uses the variant label (e.g., `opus-ultrathink`, `codex-5.4`), not `with_skill`/`without_skill`. The aggregation script discovers configurations dynamically from directory names.

---

## comparison.json

Output from blind comparator. Located at `<workspace>/iteration-<N>/comparison-<A>-vs-<B>.json`.

```json
{
  "winner": "A",
  "reasoning": "Output A provides a more thorough plan with concrete file paths and risk mitigation. Output B is shorter and lacks specificity in several phases.",
  "rubric": {
    "A": {
      "content": {
        "correctness": 5,
        "completeness": 5,
        "accuracy": 4
      },
      "structure": {
        "organization": 4,
        "formatting": 5,
        "usability": 4
      },
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {
        "correctness": 3,
        "completeness": 2,
        "accuracy": 3
      },
      "structure": {
        "organization": 3,
        "formatting": 2,
        "usability": 3
      },
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Thorough phase breakdown", "Concrete file references"],
      "weaknesses": ["Slightly verbose"]
    },
    "B": {
      "score": 5,
      "strengths": ["Concise", "Clear structure"],
      "weaknesses": ["Missing risk section", "Vague file references"]
    }
  }
}
```

