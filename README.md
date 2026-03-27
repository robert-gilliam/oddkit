<p align="center">
  <img src="assets/oddkit-title.png" alt="Oddkit" width="400" />
</p>

<p align="center">
  Lightweight workflow skills for Claude Code.
</p>

## Install

```
/plugin install oddkit@oddkit
```

## Update

```
/plugin update oddkit
```

## Skills

**`review`** — Review code or plans. Auto-detects content type.

```
/oddkit:review              # local self-review
/oddkit:review #42          # review a PR (confirm before posting)
/oddkit:review #42 --yolo   # review a PR (post without asking)
```

**`address-feedback`** — Address PR review comments: fetch, evaluate, fix, respond.

```
/oddkit:address-feedback #42          # confirm before push/reply
/oddkit:address-feedback #42 --yolo   # push and reply without asking
```

## Development

To work on oddkit locally, load the plugin directly from source instead of the cached marketplace version:

```bash
claude --plugin-dir /path/to/oddkit/oddkit
```

To make this permanent, add a shell alias:

```bash
# ~/.zshrc or ~/.bashrc
alias claude='claude --plugin-dir /path/to/oddkit/oddkit'
```

Changes take effect on next launch. Use `/reload-plugins` to pick up changes mid-session.
