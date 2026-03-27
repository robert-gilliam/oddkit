# Plan: Add Review Caching Layer

## Problem

The oddkit review skill currently fetches PR data from GitHub on every invocation. For large PRs with many files, this adds 10-15 seconds of latency. Users reviewing the same PR multiple times (e.g., after addressing feedback) re-fetch identical data.

## Proposed Solution

Add a local caching layer that stores GitHub API responses keyed by repo + PR number + commit SHA. The cache lives in `~/.oddkit/cache/` and expires after 30 minutes.

### Architecture

1. **Cache module** (`oddkit/skills/review/cache.py`) — handles read/write/expiry
2. **Integration** — the `fetch_reviews()` function in `oddkit/skills/review/github.py` checks cache before making API calls
3. **Invalidation** — cache entries are keyed by commit SHA, so pushing new commits naturally invalidates stale entries

### Implementation Steps

1. Create the `ReviewCache` class in `oddkit/skills/review/cache.py` using the existing `StorageManager` base class from `oddkit/lib/storage.py`
2. Modify the 3 GitHub API functions in `oddkit/skills/review/github.py` to check cache first
3. Add a `--no-cache` flag to the review skill's CLI parser in `oddkit/skills/review/cli.py`
4. Wire up cache clearing to the existing `/oddkit:clear` command defined in `oddkit/skills/maintenance/SKILL.md`

### Dependencies

- Uses the `rapidjson` library already in our requirements.txt for fast serialization
- Leverages the `FileWatcher` utility from `oddkit/lib/watchers.py` for cache directory monitoring

### Scope

- Only caches GET requests (reviews, comments, diff)
- Does NOT cache write operations (posting comments, submitting reviews)
- Estimated 8 files changed across 3 directories

## Success Criteria

- P50 latency for repeat reviews drops from 12s to under 2s
- Cache hit rate above 60% for typical review workflows
- No stale data served after new commits are pushed
