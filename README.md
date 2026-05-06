# clawnductor-cli

**Cross-platform CLI for [Clawnductor](https://github.com/cluncc/clawnductor)** — persistent Claude Code sessions, multi-agent ensembles, deep planning, and fleet code review. Zero external dependencies.

## What it does

Clawnductor gives you programmatic control over [Claude Code](https://claude.ai/code) from the terminal:

- **Jam sessions** — persistent Claude Code sessions that survive across invocations, with full context compaction
- **Ensembles** — multi-agent coding teams that work in parallel git worktrees and vote on consensus
- **Overture** — deep technical planning agents that explore your codebase before implementing
- **Finale** — fleet code review with specialized reviewer agents (security, logic, performance, API, types, etc.)

## Quick start

```bash
# Jam (persistent session)
clawnductor jam start my-project --cwd ~/code/myapp --model opus
clawnductor jam play my-project "add error handling to auth module"
clawnductor jam status my-project
clawnductor jam list
clawnductor jam end my-project

# Ensemble (multi-agent)
clawnductor ensemble start "implement user auth" --cwd ~/code/myapp --agents 3

# Deep planning
clawnductor overture start "add GraphQL API layer" --cwd ~/code/myapp

# Code review fleet
clawnductor finale start ~/code/myapp --agents 5 --focus "security review"
```

## Installation

```bash
# Requires Node.js >= 22
npm install -g clawnductor-cli
```

## Subcommands

| Command | Description |
|---------|-------------|
| `jam start <name>` | Create a persistent Claude Code session |
| `jam play <name> <message>` | Send a message to a session |
| `jam status <name>` | View session stats and details |
| `jam list` | List all sessions |
| `jam end <name>` | End and delete a session |
| `jam groove <name> <pattern>` | Search session message history |
| `jam bridge <name>` | Compact session context |
| `jam transpose <name> <model>` | Switch session model |
| `jam rekey <name>` | Update allowed/disallowed tools |
| `jam roster` | List agent definitions in a project |
| `ensemble start <task>` | Start multi-agent ensemble |
| `ensemble status <id>` | Check ensemble progress |
| `ensemble score <id>` | Review completed output |
| `ensemble accept <id>` | Accept ensemble work |
| `ensemble reject <id>` | Reject with feedback |
| `ensemble abort <id>` | Abort running ensemble |
| `ensemble cue <id> <msg>` | Inject message into all agents |
| `overture start <task>` | Start deep planning agent |
| `overture status <id>` | Check planning progress |
| `finale start <dir>` | Start code review fleet |
| `finale status <id>` | Check review status |
| `bandstand` | Dashboard of all active sessions |
| `purge` | Clean up old sessions/ensembles |

## Global options

- `--claude-bin <path>` — custom Claude binary path (or set `CLAUDE_BIN` env)
- `--json` — JSON output where supported
- `-h, --help` — show help
- `--version` — show version

## State

All state is stored in `~/.clawnductor/`:

- `sessions.json` — persistent jam session configs and history
- `ensembles.json` — ensemble run history and results
- `ultraplans.json` — deep planning results
- `ultrareviews.json` — code review fleet results

Override with `CLAWNDUCTOR_STATE_DIR` env var.

## Requirements

- Node.js >= 22
- Claude Code CLI in PATH (`claude`)
- A git-initialized project directory (for ensembles)

## License

Unlicensed — do whatever you want.
