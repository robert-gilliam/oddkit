// Workflow script for /oddkit:vet-prs Phase 4.
// Invoked via the Workflow tool with scriptPath. One sonnet triage agent per PR,
// schema-validated verdicts — no output parsing, no parse drift.
//
// args = { prs: [{
//   number, title, author, base_ref,
//   additions, deletions, changed_files,
//   body,              // PR description, may be ""
//   files,             // changed file paths, array of strings
//   diff_file,         // absolute path; already the truncated file for oversized PRs
//   issue_body_file,   // absolute path to cached linked-issue body, or omitted
//   oversized,         // boolean; scope is forced to L after return
// }] }
//
// Returns one entry per PR, in input order. parse_error is true only when the
// agent died or was skipped — schema validation makes off-script output a retry,
// not a failure. Timestamps (vetted_at) are stamped by the caller; workflow
// scripts cannot read the clock.

export const meta = {
  name: 'vet-prs-triage',
  description: 'Fan out one sonnet triage agent per PR, return structured verdicts',
  phases: [{ title: 'Triage', detail: 'one sonnet agent per PR', model: 'sonnet' }],
}

const VERDICT = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['S', 'M', 'L'] },
    intent: { type: 'string', enum: ['✓', '⚠️', '✗'] },
    smell: { type: 'string', enum: ['clean', 'iffy', 'red'] },
    scope_note: { type: 'string' },
    intent_note: { type: 'string' },
    smell_note: { type: 'string' },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only for ⚠️/✗ intent or iffy/red smell; point at file:line or a symbol when possible. Empty otherwise.',
    },
  },
  required: ['scope', 'intent', 'smell', 'scope_note', 'intent_note', 'smell_note', 'concerns'],
}

function triagePrompt(pr) {
  const issueSection = pr.issue_body_file
    ? `## Linked issue (intent baseline)
The PR closes this issue. Grade Intent against what the issue asks for, not just the
PR description — the description was written by the same author as the diff.
Read the issue at: ${pr.issue_body_file}

`
    : ''

  return `You are triaging a single GitHub pull request. This is a fast smoke test, not a code
review. Spend your tokens on judgment, not exploration.

## PR
- Number: #${pr.number}
- Title: ${pr.title}
- Author: ${pr.author}
- Base: ${pr.base_ref}
- Stats: +${pr.additions} -${pr.deletions} across ${pr.changed_files} files

## PR description
${pr.body || '(no description)'}

${issueSection}## Files changed
${pr.files.join('\n')}

## Diff
Read the full unified diff at: ${pr.diff_file}
Read this file first. It is your only code input.

Your only file reads are the files named above — the diff file, and the linked-issue
file if present. No other reads, greps, or web fetches.

## Your job

Return three grades and a one-line note for each. Be terse.

**Scope** — how big a change is this, really?
- S = small, easy to hold in your head (single concern, ≤~100 LOC effective)
- M = medium, multiple files or a non-trivial single file
- L = large, spans many areas or is a major change

**Intent** — does the diff match what the PR description claims? (When a linked issue
is provided above, the issue is the baseline: grade whether the diff delivers what the
issue asks for, including anything the issue requires that the diff doesn't touch.)
- ✓ = diff does what the description says, nothing surprising
- ⚠️ = mostly aligned, but the diff also does something the description doesn't
  mention (e.g., unrelated refactor, dropped tests, scope creep) — or delivers
  only part of what the linked issue asks for
- ✗ = diff and description disagree, OR there's no description and the change is
  non-obvious, OR the diff misses the point of the linked issue
Empty descriptions on tiny obvious PRs (single-line fixes, dep bumps) are still ✓.

**Smell** — any visible red flags in the diff itself?
- clean = nothing jumps out
- iffy = something worth a closer look (removed error handling, suspicious deletes,
  commented-out code, magic numbers in security-adjacent paths, large blocks of
  unexplained logic)
- red = a hard "no" until explained (hardcoded secrets, deleted tests with no
  replacement, dropped migrations, disabled checks, anything that looks like a backdoor)

Do not invent issues to justify your existence. A clean, well-scoped, well-described PR
is allowed to be S / ✓ / clean with three boring one-liners.`
}

const verdicts = await parallel(
  args.prs.map(pr => () =>
    agent(triagePrompt(pr), {
      model: 'sonnet',
      schema: VERDICT,
      label: `vet:#${pr.number}`,
      phase: 'Triage',
    })
  )
)

return args.prs.map((pr, i) => {
  const v = verdicts[i]
  if (!v) return { pr_number: pr.number, title: pr.title, parse_error: true }
  if (pr.oversized) v.scope = 'L'
  return {
    pr_number: pr.number,
    title: pr.title,
    ...v,
    oversized: Boolean(pr.oversized),
    parse_error: false,
  }
})
