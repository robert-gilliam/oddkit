#!/usr/bin/env bash
# Toggle every functional opus model selector in oddkit between opus and fable.
#
# Local dev convenience only. Flip to fable to run the kit cheap; flip back to
# opus before you commit so the fable state never ships.
#
#   scripts/model-toggle.sh          # flip to the other model
#   scripts/model-toggle.sh fable    # force -> fable
#   scripts/model-toggle.sh opus     # force -> opus
#   scripts/model-toggle.sh status   # print current model, change nothing
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kit="$repo_root/oddkit"
burndown="$kit/skills/burndown-implement/SKILL.md"

# Current model = fable if any `model: fable` selector exists, else opus.
current() {
  if grep -rq "model: fable" "$kit"; then echo fable; else echo opus; fi
}

swap() {
  local from="$1" to="$2"

  # 1. Exact `model: <x>` token, anywhere under oddkit/. Catches every skill and
  #    agent frontmatter plus the backticked `model:` directive in burndown, and
  #    auto-picks up any new skill you add. Never matches prose, docs, or eval's
  #    `claude-opus-4-6` examples.
  local files
  files="$(grep -rl "model: $from" "$kit" || true)"
  if [ -n "$files" ]; then
    printf '%s\n' "$files" | while IFS= read -r f; do
      sed -i '' "s/model: $from/model: $to/g" "$f"
    done
  fi

  # 2. Burndown prose directives, scoped to burndown-implement/SKILL.md only so
  #    the "Don't let it default to opus" warning in vet-prs is never touched.
  sed -i '' "s/→ $from/→ $to/g; s/\`$from\`/\`$to\`/g" "$burndown"
}

case "${1:-}" in
  status) echo "Current: $(current)"; exit 0 ;;
  opus|fable) target="$1" ;;
  "") [ "$(current)" = opus ] && target=fable || target=opus ;;
  *) echo "usage: model-toggle.sh [opus|fable|status]" >&2; exit 1 ;;
esac

cur="$(current)"
if [ "$cur" = "$target" ]; then
  echo "Already on $target. Nothing to do."
  exit 0
fi

swap "$cur" "$target"
echo "Flipped $cur → $target."
[ "$target" = fable ] && echo "⚠  oddkit is on fable. Flip back before committing: scripts/model-toggle.sh opus"
exit 0
