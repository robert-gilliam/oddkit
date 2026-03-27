---
name: update
description: >
  Update oddkit to the latest version from GitHub.
  Use when the user wants to update oddkit, get the latest skills, or says /oddkit:update.
---

# Update oddkit

Pull the latest version from GitHub and refresh the local cache.

## Step 1 — Find the marketplace clone

Read `~/.claude/plugins/known_marketplaces.json` and find the oddkit entry. Match by looking for an entry whose `source.repo` contains `oddkit` or whose key is `oddkit`.

Extract the `installPath` — this is where the marketplace repo is cloned locally.

If no oddkit entry exists, stop:

"oddkit marketplace not found. Install it first:

```
claude plugin marketplace add robert-gilliam/oddkit
claude plugin install oddkit@oddkit
```
"

### Detect directory-source installs

If the entry's `source.source` is `"directory"` (not `"github"`), stop:

"You're on a dev install — oddkit loads directly from your local repo. Just `git pull` to update."

## Step 2 — Read current version

```bash
cat <installPath>/oddkit/.claude-plugin/plugin.json
```

Parse the current version. Store as `OLD_VERSION`.

## Step 3 — Pull latest from GitHub

```bash
git -C <installPath> fetch origin main
git -C <installPath> reset --hard origin/main
```

Use `fetch + reset --hard` instead of `pull` — the marketplace clone is a read-only copy with no user work to preserve. This avoids merge conflicts if the clone has unexpected local state.

If this fails, stop and report the error. Suggest checking network connectivity and GitHub access.

## Step 4 — Read new version

```bash
cat <installPath>/oddkit/.claude-plugin/plugin.json
```

Parse the new version. Store as `NEW_VERSION`.

If `OLD_VERSION` equals `NEW_VERSION`, stop: "Already on the latest version ($NEW_VERSION). No update needed."

## Step 5 — Clear cache and reinstall

```bash
rm -rf ~/.claude/plugins/cache/oddkit/
claude plugin install oddkit@oddkit
```

If `claude plugin install` fails, report the error and show manual steps:

"Automatic reinstall failed. Try manually:

```
rm -rf ~/.claude/plugins/cache/oddkit/
claude plugin install oddkit@oddkit
```
"

## Step 6 — Report

Print:

```
oddkit updated: $OLD_VERSION → $NEW_VERSION

Restart Claude Code to load the new version.
```
