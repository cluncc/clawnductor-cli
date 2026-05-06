# clawnductor-cli — Engineering Journal

## Overview

clawnductor-cli is a zero-external-dependency Node.js CLI that replicates the functionality of the `clawnductor` OpenClaw plugin as a standalone, cross-platform binary. It wraps the `claude` CLI (Anthropic's official Claude Code tool) to provide:

- **Persistent sessions** (`jam`) — resume multi-turn Claude conversations across invocations
- **Multi-agent ensembles** (`ensemble`) — parallel agents collaborating on a task across git worktrees
- **Deep planning** (`overture`) — ultraplan mode: a single planning agent writes a comprehensive implementation plan
- **Fleet code review** (`finale`) — ultrareview mode: up to 20 specialized review agents produce parallel findings
- **Health dashboard** (`bandstand`) — overview of all active sessions and ensembles
- **State purge** (`purge`) — delegate to `claude project purge` for MRU session cleanup

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js ≥22 | Stable ESM, built-in `node:test`, `crypto.randomUUID()`, `fs.mkdirSync({ recursive: true })` |
| Language | TypeScript 5.7 | Full strict mode, `NodeNext` module resolution for `.js` extension compatibility |
| Module system | ESM (`"type": "module"`) | No CommonJS legacy baggage; aligns with Node's direction |
| External deps | **Zero** | Reduces supply-chain risk; everything needed is in Node's standard library |
| Test runner | `node:test` (built-in) | No extra dependencies; available in Node 22 |
| Claude interface | `claude` CLI subprocess | The only supported API surface for driving Claude Code sessions |

### Why no HTTP API?

The project interacts with Claude via the official `claude` CLI rather than the Anthropic HTTP API directly. This means:
- Session continuity (`--resume`) works out of the box
- Permission mode (`bypassPermissions`, `acceptEdits`, etc.) is respected
- Tool use (Bash, Read, Write, etc.) works without re-implementing it
- The binary handles auth automatically

---

## Architecture

### Stateless session model

Sessions are **stateless** from the CLI's perspective. There is no persistent subprocess. Each `jam play` invocation:

1. Reads stored session metadata from `~/.clawnductor/sessions.json`
2. Spawns `claude -p --input-format stream-json --output-format stream-json --resume <session-id>` in a fresh subprocess
3. Sends one message, streams back the response
4. Stores the updated Claude session ID, stats, and last N messages
5. Terminates the subprocess

The Claude backend maintains the conversation history identified by the session ID. The CLI just needs to pass `--resume` to pick up where things left off.

**Tradeoff:** No real-time busy/ready state — the CLI cannot tell if Claude is "thinking" between CLI invocations. This is acceptable for a command-line tool where one human turn equals one CLI invocation.

### Ensemble model (live subprocess)

Ensemble is the exception: each agent runs as a **persistent** `PersistentClaudeSession` (a live subprocess) for the duration of the ensemble run. Agents work in parallel across git worktrees on isolated branches, communicating only through git (merge to main, cross-review).

Architecture of one ensemble run:
```
ensemble start
├── git init / ensure HEAD commit
├── for each agent:
│   └── git worktree add .worktrees/<name> ensemble/<name>
├── rounds 1..maxRounds (parallel per round):
│   └── each agent: send prompt → wait for [CONSENSUS: YES/NO]
├── if all YES → status = consensus
│   or max rounds → status = max_rounds
└── ensemble accept/reject (user-triggered)
```

Cue injection uses file-based IPC: `~/.clawnductor/ensemble-cues/<id>.json` is polled every 2 seconds by the running ensemble process. This allows a second terminal to inject director messages mid-run without signals.

### State layout

```
~/.clawnductor/
├── sessions.json           # jam session metadata (keyed by name)
├── ensembles.json          # ensemble records (keyed by UUID)
├── ultraplans.json         # overture run records (keyed by UUID)
├── ultrareviews.json       # finale run records (keyed by UUID)
├── ensemble-cues/
│   └── <ensemble-id>.json  # pending cue messages for in-flight injection
└── ensemble-logs/
    └── ensemble-<id>.json  # full ensemble state snapshot (written each round)
```

All writes use:
- **0o600 permissions** (owner-read/write only; prevents other-user snooping on local systems)
- **0o700 directory permissions** for the state dir itself
- **Atomic POSIX write** (write `.pid.tmp` → `rename`) so concurrent readers never see a partial file
- **Windows fallback** to direct write (POSIX `rename` over existing throws `EPERM` on Windows)

The state directory is configurable via `CLAWNDUCTOR_STATE_DIR` env var or `setStateDir()` (used by tests).

---

## Module Map

| File | Responsibility |
|------|----------------|
| `src/cli.ts` | Command dispatch, argument parsing, user-facing I/O |
| `src/args.ts` | Argument parser (`parseArgs`, `optStr`, `optBool`, `optInt`) |
| `src/session.ts` | `PersistentClaudeSession` class + `buildArgs()` |
| `src/ensemble.ts` | `Ensemble` class, git helpers, prompt builders |
| `src/state.ts` | Disk-based state CRUD (sessions, ensembles, plans, reviews, cues) |
| `src/types.ts` | Shared TypeScript interfaces, constants, agent/reviewer pools |
| `src/validation.ts` | Input validation functions (all user-controlled data passes through here) |

---

## Security Audit

### Attack surface

This is a **local CLI tool** run by a single authenticated user on their own machine. There is no network server, no HTTP endpoints, no multi-user context. Classic web vulnerabilities (XSS, CSRF, SQLi, session hijacking, IDOR) are **not applicable** in the traditional sense, but the following considerations apply:

### Argument injection (primary risk)

User-supplied strings are forwarded to the `claude` subprocess via `spawn()`. Since `spawn` passes arguments as a true array (not shell-interpolated), standard shell injection is not possible. However, arguments containing leading dashes could be misinterpreted by the `claude` binary as flags.

**Mitigations in place:**
- `validateModel()` — restricts to `[A-Za-z0-9._:-]+` (no leading dashes, no spaces)
- `validateToolName()` — restricts to `[A-Za-z][A-Za-z0-9_:*-]*|^\*$`
- `validatePermissionMode()` — enum allowlist
- `validateEffort()` — enum allowlist
- `validateName()` — `[A-Za-z0-9._-]+` (session names used as dict keys only)
- `validateAgentName()` — `[A-Za-z0-9][A-Za-z0-9-]*` (used in git branch names)

**Note:** All tool names and model strings are validated before being forwarded to the subprocess.

### Path traversal

User-supplied `--cwd` values go through `validateCwd()` which:
1. Resolves the path with `path.resolve()` (canonicalizes `..` segments)
2. Rejects paths under `/proc`, `/sys`, `/dev`, `/run/user` (POSIX) to prevent agent access to kernel pseudo-filesystems
3. Enforces maximum path length (500 chars)

Agent names go through `validateAgentName()` — restricted to `[A-Za-z0-9][A-Za-z0-9-]*`. These are used to construct worktree paths (`projectDir/.worktrees/<name>`). No `../` traversal is possible through agent names.

Ensemble log files use `assertSafeId()` (UUID regex) before constructing paths, preventing path injection via ensemble IDs.

### Regex DoS (ReDoS)

The `jam groove` command accepts a user-supplied regex for history search. `validateRegex()` blocks:
- Nested quantifiers (`++`, `**`, `(a+)+`)
- Quantified alternation groups `(a|b)*`
- Patterns exceeding 500 characters

This prevents catastrophic backtracking attacks against the local process.

### File permissions

All state files: `0o600` (owner read/write only)  
State directory: `0o700` (owner access only)  
These prevent other local users from reading session IDs, conversation history, or ensemble state on shared POSIX systems.

### PID-based abort

`ensemble abort <id>` sends `SIGINT` to the PID stored in the ensemble record. An attacker who can write to the state file could target arbitrary PIDs. Since the state file is `0o600` (owner-only), this is only exploitable if the attacker already has filesystem access as the same user — at which point the machine is already compromised.

### Subprocess execution

The `claude` binary path can be overridden via `--claude-bin` or `CLAUDE_BIN` env var. No validation is applied to the binary path itself — it must be trusted input from the operator. Avoid running clawnductor as root.

### No AuthN/AuthZ, no CSRF, no session hijacking

The tool is local-only, single-user, no HTTP surface. These classes of vulnerabilities do not apply.

---

## Input Validation Reference

Every external input is validated before use:

| Input | Validator | Restriction |
|-------|-----------|-------------|
| Session name | `validateName` | `[A-Za-z0-9._-]`, max 100 chars |
| Agent name | `validateAgentName` | `[A-Za-z0-9][A-Za-z0-9-]*`, max 50 chars |
| UUID (ensemble/plan IDs) | `validateId` | Full UUID regex |
| Working directory | `validateCwd` | `path.resolve()`, no forbidden system paths |
| Model name | `validateModel` | `[A-Za-z0-9._:-]+`, max 100 chars |
| Tool name | `validateToolName` | `[A-Za-z][A-Za-z0-9_:*-]*` or `*` |
| Permission mode | `validatePermissionMode` | Enum: bypassPermissions/acceptEdits/auto/plan |
| Effort level | `validateEffort` | Enum: low/medium/high/xhigh/max/auto |
| Timeout (ms) | `validateTimeout` | 1,000 – 86,400,000 |
| Positive integer | `validatePositiveInt` | ≥1, optional max |
| Regex pattern | `validateRegex` | Valid JS regex, no ReDoS patterns, max 500 chars |
| Arbitrary string | `validateStringField` | Non-empty, max 50,000 chars |

---

## Design Decisions

### Why `spawn` instead of `exec`/`execFile` for all subprocess calls?

`spawn` streams output without buffering the entire response in memory. For long Claude responses (potentially hundreds of KB), this is essential for streaming chunks to the terminal. `exec`/`execFile` buffer all output before returning — fine for git commands (short output), used there.

### Why file-based IPC for cue injection?

The ensemble process runs in the foreground of terminal A. To inject a cue from terminal B without disrupting the running process, we use a cue file. The running process polls for it every 2 seconds. Alternatives (Unix sockets, pipes) would require additional server infrastructure and cross-platform compat work.

### Why uuid-guarded file paths?

Ensemble IDs come from `randomUUID()` internally, but ensemble-cue and log file paths are also accessed from external `cue` commands that accept user-supplied IDs. UUID validation prevents path traversal: `../../etc/passwd` is not a valid UUID.

### Why atomic writes?

Session files are read-modify-written on every `jam play`. If the process is killed mid-write (e.g., Ctrl-C), a partial JSON file would permanently corrupt the session store. Atomic rename (`write tmp → rename`) ensures readers always see a complete valid file.

### Why `0o600` / `0o700` permissions?

Session data contains Claude session IDs (which grant conversation access), conversation history (potentially sensitive), and agent PID information. On shared POSIX machines, `0o600` prevents other local users from accessing this data.

### Stateless sessions vs. persistent subprocess

A persistent subprocess (e.g., a daemon) would allow real-time session status, true busy/ready detection, and lower per-message latency. But it adds substantial complexity: process supervision, IPC, crash recovery, cross-platform signal handling. For a developer tool where the interaction pattern is "one command per turn," stateless is simpler and equally capable.

---

## Development Setup

### Prerequisites

- Node.js ≥22.0.0
- `claude` CLI installed and in PATH (or set `CLAUDE_BIN`)
- TypeScript knowledge (for development; not needed to run the built CLI)

### Install

```bash
git clone <repo>
cd clawnductor-cli
npm install          # installs TypeScript and @types/node (dev only)
npm run build        # compiles src/ → dist/
```

### Run locally

```bash
node dist/src/cli.js jam start my-session --cwd ~/myproject
node dist/src/cli.js jam play my-session "implement user auth"
```

Or install globally:

```bash
npm install -g .
clawnductor jam start my-session --cwd ~/myproject
```

### Run tests

```bash
npm test
# Compiles src/ (including test files) → dist-test/ via tsconfig.test.json
# Then runs all *.test.js files with node --test
```

Tests use real filesystem I/O via temp directories (`fs.mkdtempSync`) with `setStateDir()` for isolation. No mocking, no external services needed.

### Watch mode (dev)

```bash
npx tsc --watch
```

---

## Build & Deployment

### Build artifacts

```
dist/
└── src/
    ├── cli.js          ← binary entry point
    ├── cli.d.ts        ← type declarations
    ├── session.js
    ├── ensemble.js
    ├── state.js
    ├── validation.js
    ├── args.js
    └── types.js
configs/
└── council-system-prompt.md   ← ensemble system prompt template
```

### npm publish

The `files` field in `package.json` limits the published package to `dist/`, `configs/`, and `README.md`. Test files compiled to `dist-test/` are not included (separate `outDir`). Dev dependencies (TypeScript, `@types/node`) are not shipped.

```bash
npm run build        # runs tsc (also triggered by prepublishOnly hook)
npm publish          # publishes to npm registry
```

### Global install from npm

```bash
npm install -g clawnductor-cli
clawnductor --help
```

### Global install from local clone

```bash
npm install -g .     # links dist/src/cli.js as the 'clawnductor' binary
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_BIN` | `claude` | Path to claude CLI binary |
| `CLAWNDUCTOR_STATE_DIR` | `~/.clawnductor` | State directory override |

### Docker / CI

There is no Dockerfile. For CI usage, ensure Node ≥22 and the `claude` CLI are available:

```bash
# Example GitHub Actions step
- uses: actions/setup-node@v4
  with:
    node-version: '22'
- run: npm ci && npm run build && npm test
```

Note: Tests do NOT require the `claude` binary — they test pure logic and file I/O only.

---

## Known Limitations

1. **No real-time status** — `jam status` shows stored stats from the last `play`, not a live Claude process state.
2. **Session ID trust** — The Claude session ID stored in `sessions.json` is treated as opaque. If the Claude backend invalidates it (e.g., session expiry), the next `jam play` will fail and the user must recreate the session.
3. **Single-machine only** — State is local to `~/.clawnductor/`. No sync or remote state.
4. **Ensemble merge conflicts** — Agents are instructed to auto-resolve conflicts, but pathological conflicts (e.g., both agents delete the same file) may cause a round to error.
5. **Windows rename fallback** — The `EPERM` fallback on Windows means session file writes are not atomic. Concurrent writes (rare for a CLI) could corrupt the state file.
6. **No rate limiting** — Multiple parallel ensemble agents all hit the Claude API simultaneously. If your API tier has low RPM limits, large ensembles may hit rate limits and retry.
7. **claude binary version** — The `--replay-user-messages` and `--include-partial-messages` flags must be supported by the installed `claude` version. Older versions may not support all flags used in `buildArgs()`.

---

## Changelog

### v1.0.0 (initial release + audit)

- Initial implementation of all commands
- Security audit and input validation hardening:
  - Model strings validated before subprocess forwarding
  - Tool names validated in `jam start` and `jam rekey`
  - Permission mode uses runtime validation instead of unsafe cast in `ensemble start`
  - Task and cue message strings bounded by `validateStringField`
  - `jam roster --cwd` path validated with `validateCwd`
- Bug fixes:
  - `ensemble.ts` `_logPath()` now respects `CLAWNDUCTOR_STATE_DIR` override (was hardcoded to `homedir()`)
  - `jam bridge` now uses `session.compact()` instead of duplicating the logic
- Dead code removed:
  - Duplicate `parseArgs`/`optStr`/`optBool`/`optInt`/`ParsedArgs` from `cli.ts` (canonical version in `args.ts`)
  - `SessionConfig.bare` — was set but never acted on in `buildArgs()`
  - `SessionConfig.noSessionPersistence` — never set or read anywhere
- 208 unit tests added covering all validation functions, argument parsing, state I/O, ensemble utilities, and session arg building
