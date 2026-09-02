// Workflow script for /oddkit:review Steps 2–3b.
// Runs the review agents, dedupes exact-duplicate findings, then verifies every
// survivor with a throwaway sonnet agent so file reads never land in the
// orchestrator's context. Steps 3c/3d (consolidate, recommend) stay with the caller.
//
// args = {
//   mode,          // 'code' | 'plan'
//   diff_file,     // absolute path to the diff; omit for single-file review
//   file_path,     // absolute path to the file under review (no-diff mode); omit otherwise
//   review_root,   // absolute path agents must search for codebase reads; omit for local
//   pr_files,      // changed file paths (GitHub reviews); omit otherwise
//   pr_body,       // PR description or plan context, may be ""
// }
//
// Returns { findings: [...], discarded: n }. Each finding carries severity, the
// agents that flagged it, and the verified line number.

export const meta = {
  name: 'review-findings',
  description: 'Run review agents, dedupe, and verify every finding',
  phases: [
    { title: 'Review', detail: 'three review agents in parallel' },
    { title: 'Verify', detail: 'one sonnet verifier per finding', model: 'sonnet' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          snippet: { type: 'string', description: 'Verbatim code or text from the change under review' },
          severity: { type: 'string', enum: ['BLOCKING', 'WARNING'] },
          issue: { type: 'string', description: 'One line' },
          fix: { type: 'string', description: 'One-line suggested fix, empty if none' },
        },
        required: ['file', 'snippet', 'severity', 'issue'],
      },
    },
  },
  required: ['findings'],
}

const VERIFY = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'discard'] },
    reason: { type: 'string', description: 'One line' },
    line: { type: 'integer', description: 'Line number of the snippet in the current file, 0 if not applicable' },
  },
  required: ['verdict', 'reason', 'line'],
}

const source = args.diff_file
  ? `Read the full unified diff at ${args.diff_file} before doing anything else. It is the change under review.`
  : `Read the file under review at ${args.file_path} before doing anything else.`

const shared = [
  source,
  args.pr_files
    ? `Only report findings in these files. These are the files in the PR diff:\n${args.pr_files.join('\n')}`
    : '',
  args.review_root
    ? `Search the codebase at ${args.review_root} (not the repo root) for all file reads, globs, and greps${args.diff_file ? ` — except the diff file at ${args.diff_file}` : ''}.`
    : '',
  'Quote exact snippets from the change under review for every finding. Return an empty findings array if there are no issues — do not invent findings.',
].filter(Boolean).join('\n\n')

const reviewers =
  args.mode === 'plan'
    ? [
        { type: 'oddkit:fact-checker', extra: args.pr_body },
        { type: 'oddkit:completeness-auditor', extra: args.pr_body },
        {
          type: 'oddkit:design-critic',
          extra: `You're reviewing an implementation plan. Evaluate whether the proposed design is sound, appropriately scoped, and as simple as it can be. Search the codebase for existing patterns the plan could leverage.\n\n${args.pr_body || ''}`,
        },
      ]
    : [
        { type: 'oddkit:correctness', extra: '' }, // no PR description — mechanical review only
        ...(args.pr_body
          ? [{
              type: 'oddkit:intent-checker',
              extra: `Compare what the PR says it does against what the code actually does. Flag mismatches, unstated changes, and incomplete coverage of stated goals.\n\nPR description:\n${args.pr_body}`,
            }]
          : []),
        {
          type: 'oddkit:design-critic',
          extra: `You're reviewing a code change. Search the codebase for existing patterns that could simplify or replace this approach.${args.pr_body ? `\n\nPR description:\n${args.pr_body}` : ''}`,
        },
      ]

phase('Review')
// Barrier on purpose: dedup needs every reviewer's findings before verification,
// or the same finding gets verified once per agent that flagged it.
const results = await parallel(
  reviewers.map(r => () =>
    agent([shared, r.extra].filter(Boolean).join('\n\n'), {
      agentType: r.type,
      schema: FINDINGS,
      label: r.type.replace('oddkit:', ''),
      phase: 'Review',
    }).then(out => ({ agent: r.type.replace('oddkit:', ''), findings: out.findings }))
  )
)

const byKey = new Map()
for (const r of results.filter(Boolean)) {
  for (const f of r.findings) {
    const key = `${f.file}::${f.snippet.replace(/\s+/g, ' ').trim()}`
    const seen = byKey.get(key)
    if (seen) {
      seen.agents.push(r.agent)
      if (f.severity === 'BLOCKING') seen.severity = 'BLOCKING'
    } else {
      byKey.set(key, { ...f, agents: [r.agent] })
    }
  }
}
const deduped = [...byKey.values()]
log(`${deduped.length} unique findings to verify`)

phase('Verify')
const planRules =
  args.mode === 'plan'
    ? `\n\nThis is a plan review. Also discard if: acting on it would add complexity rather than remove it; it's a prose-quality nit, a "worth discussing" item, or an equally-valid alternative. Keep it only if it would cause an agent to build the wrong thing or get stuck.`
    : ''

const verified = await parallel(
  deduped.map(f => () =>
    agent(
      `Verify one code-review finding. Decide whether it is real, then return your verdict.

Finding: ${f.issue}
File: ${f.file}
Snippet:
${f.snippet}

Steps:
1. ${args.diff_file ? `Read the file at the reported path${args.review_root ? ` under ${args.review_root}` : ''} and search for the snippet to find its line number.` : `Search ${args.file_path} for the snippet.`}
2. Check at least 20 lines of surrounding context. Trace callers, callees, and types as needed${args.review_root ? ` (all reads under ${args.review_root})` : ''}.
3. ${args.diff_file ? `If you need to confirm a hunk is part of the change, read the diff at ${args.diff_file} — don't refetch it.` : 'Confirm the issue against the file contents.'}

Discard if: the snippet doesn't exist (hallucinated); the issue doesn't exist in the
actual code; it's handled elsewhere (null check upstream, etc.); or the concern is
theoretical and the code path can't be triggered.${planRules}

Default to discard when uncertain.`,
      { model: 'sonnet', schema: VERIFY, label: `verify:${f.file}`, phase: 'Verify' }
    ).then(v => ({ f, v }))
  )
)

const confirmed = verified
  .filter(Boolean)
  .filter(({ v }) => v.verdict === 'confirmed')
  .map(({ f, v }) => ({ ...f, line: v.line, verify_note: v.reason }))

return { findings: confirmed, discarded: deduped.length - confirmed.length }
