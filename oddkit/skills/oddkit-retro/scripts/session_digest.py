#!/usr/bin/env python3
"""Digest a Claude Code session transcript into a compact friction report.

Extracts the deterministic signals worth looking at in a retro: which oddkit
skills ran, how the permission mode moved, tool errors, tool usage counts, and a
few heuristic red flags. It does not judge — it points you at the story so you
can read the transcript slices that matter.

Usage:
    session_digest.py [TRANSCRIPT.jsonl]

With no argument it finds the newest .jsonl under the project dir that maps to
the current working directory (the live session is the one being written now).
"""
import json
import os
import sys
from collections import Counter


def find_transcript():
    home = os.path.expanduser("~")
    projects = os.path.join(home, ".claude", "projects")
    slug = os.getcwd().replace("/", "-")
    candidates = []
    for d in (os.path.join(projects, slug), projects):
        if os.path.isdir(d):
            for root, _, files in os.walk(d):
                for f in files:
                    if f.endswith(".jsonl"):
                        candidates.append(os.path.join(root, f))
            if candidates:
                break
    if not candidates:
        sys.exit(f"No transcript found under {projects}. Pass one explicitly.")
    return max(candidates, key=os.path.getmtime)


def load(path):
    for line in open(path):
        line = line.strip()
        if line:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                out.append(c.get("text", ""))
        return " ".join(out)
    return ""


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else find_transcript()
    records = list(load(path))

    skills, perm_timeline, errors = [], [], []
    tool_counts, worktree_cmds, oddkit_writes = Counter(), [], []
    user_prompts = []

    for i, d in enumerate(records):
        t = d.get("type")
        if t == "permission-mode":
            mode = d.get("permissionMode")
            if not perm_timeline or perm_timeline[-1] != mode:
                perm_timeline.append(mode)
        elif t == "user":
            content = d.get("message", {}).get("content", [])
            has_tool_result = False
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        has_tool_result = True
                        if c.get("is_error"):
                            errors.append(text_of(c.get("content"))[:160].replace("\n", " "))
            # A real typed prompt carries text and no tool_result echo.
            txt = text_of(content).strip()
            if txt and not has_tool_result:
                user_prompts.append(txt[:120].replace("\n", " "))
        elif t == "assistant":
            for c in d.get("message", {}).get("content", []):
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                name = c.get("name", "")
                tool_counts[name] += 1
                inp = c.get("input", {}) or {}
                if name == "Skill":
                    s = inp.get("skill", "")
                    if s.startswith("oddkit:"):
                        skills.append((i, s))
                if name == "Bash":
                    cmd = inp.get("command", "")
                    if "worktree" in cmd:
                        worktree_cmds.append(cmd[:120].replace("\n", " "))
                    if ".oddkit/" in cmd and any(w in cmd for w in ("cat >", "tee ", "echo ", "mkdir")):
                        oddkit_writes.append(cmd[:120].replace("\n", " "))
                if name in ("Write", "Edit") and ".oddkit/" in str(inp.get("file_path", "")):
                    oddkit_writes.append(str(inp.get("file_path")))

    p = print
    p(f"# Session digest")
    p(f"Transcript: {path}")
    p(f"Records: {len(records)}  |  User prompts: {len(user_prompts)}\n")

    p("## oddkit skills invoked")
    p("\n".join(f"- {s}  (record #{i})" for i, s in skills) if skills else
      "- none — no oddkit skills ran this session. Likely nothing to retro.")
    p("")

    p("## Permission-mode timeline")
    p((" → ".join(perm_timeline) if perm_timeline else "unchanged") +
      (f"   ({len(perm_timeline)} distinct states)" if len(perm_timeline) > 2 else ""))
    p("")

    p(f"## Tool errors ({len(errors)})")
    if errors:
        for e, n in Counter(errors).most_common(10):
            p(f"- ×{n}  {e}")
    else:
        p("- none")
    p("")

    p("## Tool usage")
    p("  ".join(f"{k}:{v}" for k, v in tool_counts.most_common()) or "none")
    p("")

    if worktree_cmds:
        p(f"## Worktree commands ({len(worktree_cmds)})")
        for c in worktree_cmds:
            p(f"- {c}")
        p("")
    if oddkit_writes:
        p(f"## Writes into .oddkit/ ({len(oddkit_writes)})")
        for w in oddkit_writes:
            p(f"- {w}")
        p("")

    p("## User prompts (scan for corrections / redirections)")
    for u in user_prompts:
        p(f"- {u}")


if __name__ == "__main__":
    main()
