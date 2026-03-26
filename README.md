<p align="center">
  <img src="assets/oddkit-title.png" alt="Oddkit" width="400" />
</p>

<p align="center">
  Compact workflow skills for Claude Code.
</p>

## Install

```
/plugin marketplace add robert-gilliam/oddkit
/plugin install oddkit
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

```
/reload-plugins
```
