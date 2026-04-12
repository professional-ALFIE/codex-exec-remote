# codex-exec-remote

> **Run commands on a Codex app-server session from the terminal.**
>
> The stock `codex exec` cannot connect to a running `codex app-server`. This tool can.

- [Releases](https://github.com/professional-ALFIE/codex-exec-remote/releases)
- [한국어](./README.ko.md)

> ⚠️ **Full permission mode.** `codex-exec-remote` auto-approves all server requests (command execution, file changes, etc.) — equivalent to running `codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check`. Use with the same caution.

## Quick Start

### One-liner Installation

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/codex-exec-remote/master/install.sh | bash
```

### First run

```bash
# 1. Start the app-server (or let codex-exec-remote do it automatically)
codex-exec-remote

# 2. In another terminal, send a prompt
codex-exec-remote start "hello"
```

---

## Why?

### `codex exec` doesn't support app-server

`codex exec` runs a one-shot prompt locally. It **cannot** attach to a running `codex app-server` instance — no remote connection, no multi-client sync.

`codex-exec-remote` fills that gap:

| | `codex exec` | `codex-exec-remote` |
|---|---|---|
| Connect to remote app-server | ✗ | ✓ |
| Remote thread resume | ✗ | ✓ (`resume`) |
| Start new thread on server | ✗ | ✓ (`start`) |
| Multi-client session sync | ✗ | ✓ |
| Launch app-server | ✗ | ✓ (default mode) |
| ThreadEvent JSONL output | ✓ | ✓ (`--json`) |

### Use from other agents

While working in Claude Code, Antigravity, or any CLI agent:

```bash
codex-exec-remote start "refactor this module"
codex-exec-remote resume --last "continue"
```

Your main agent stays focused; **Codex handles sub-tasks via app-server.**

---

## What does it do?

| Command | Effect |
|---------|--------|
| `codex-exec-remote` | **Launch** app-server in full-permission mode (`ws://127.0.0.1:4501`) |
| `codex-exec-remote start "hello"` | **New thread** on the server, send a turn, print response |
| `codex-exec-remote resume <id> "hello"` | **Resume** existing thread |
| `codex-exec-remote resume --last "hello"` | **Resume** most recent thread |

---

## Installation

### One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/codex-exec-remote/master/install.sh | bash
```

What it does:
- Clones or updates the repo under `~/.codex-exec-remote/source`
- Installs dependencies with `bun install`
- Compiles a single binary with `bun build --compile`
- Copies the compiled binary into `~/.codex-exec-remote/runtime`
- Installs `codex-exec-remote` and `cer` launchers into the first writable absolute directory on the default noninteractive `bash -c` `PATH` (typically `/usr/local/bin`), ignoring relative PATH entries such as `.` or `./bin`
- Records the current `codex` absolute path via `CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN` so plain `cer` can still launch `codex app-server` in a clean shell
- Verifies `cer --help` and `codex-exec-remote --help` inside `env -i HOME="$HOME" /bin/bash -c`, and also verifies that the recorded `codex` binary can execute `app-server --help`

**Required:** macOS or Linux, [Codex CLI](https://github.com/openai/codex) installed, Git, [Bun](https://bun.sh)

> **Update?** Just run the same command again.
>
> **Need a custom launcher directory?** Set `CODEX_EXEC_REMOTE_BIN_DIR=/path` before running the installer. If that directory is not on the default noninteractive `PATH`, the installer falls back to shell profile updates for interactive use.
>
> **Need to override the recorded codex binary later?** Launch with `CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN=/absolute/path/to/codex` to override the installer-pinned default.

### Via Bun (global)

```bash
bun install -g codex-exec-remote
```

> Requires [Bun](https://bun.sh) runtime at execution time.

### Manual installation

```bash
git clone https://github.com/professional-ALFIE/codex-exec-remote.git ~/.codex-exec-remote/source
cd ~/.codex-exec-remote/source
bun install --frozen-lockfile || bun install
bun run build

CODEX_BIN="$(command -v codex)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
CODEX_BIN_DIR="$(dirname "$CODEX_BIN")"

mkdir -p ~/.codex-exec-remote/runtime /usr/local/bin
cp codex-exec-remote ~/.codex-exec-remote/runtime/codex-exec-remote

cat > /usr/local/bin/codex-exec-remote <<EOF
#!/bin/sh
set -eu
PATH='$NODE_BIN_DIR:$CODEX_BIN_DIR':\$PATH
export PATH
: \${CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN:='$CODEX_BIN'}
export CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN
exec '$HOME/.codex-exec-remote/runtime/codex-exec-remote' "\$@"
EOF

chmod +x /usr/local/bin/codex-exec-remote
ln -sfn codex-exec-remote /usr/local/bin/cer
```

Use a writable absolute directory from your clean noninteractive `PATH` in place of `/usr/local/bin` if your environment differs. Relative PATH entries such as `.` or `./bin` are ignored for automatic launcher placement.

Verify the launchers in a clean noninteractive shell:

```bash
env -i HOME="$HOME" /bin/bash -c 'PATH="/usr/local/bin:/bin:/usr/bin"; cer --help >/dev/null && codex-exec-remote --help >/dev/null'
```

The installer also checks that the recorded `codex` binary can run `app-server --help` inside the same clean shell.

---

## Usage

> `cer` is a short alias for `codex-exec-remote`. Both work identically.

```bash
# Launch app-server (default ws://127.0.0.1:4501)
codex-exec-remote            # or: cer

# Launch app-server on custom address
codex-exec-remote --listen ws://127.0.0.1:9999  # or: cer --listen ws://127.0.0.1:9999

# Start a new thread
codex-exec-remote start "hello"           # or: cer start "hello"

# Resume an existing thread
codex-exec-remote resume <thread-id> "hello"

# Resume the most recent thread
codex-exec-remote resume --last "hello"   # or: cer resume -l "hello"

# JSON output (ThreadEvent JSONL → stdout)
codex-exec-remote start "hello" --json    # or: cer start "hello" -j
```

---

## Options

### Serve mode

| Option | Default | Description |
|--------|---------|-------------|
| `--listen <url>` | `ws://127.0.0.1:4501` | Address for `codex app-server` |
| `--codex-bin <path>` | `codex` | Path to codex binary |

### Start / Resume (shared)

| Option | Default | Description |
|--------|---------|-------------|
| `--remote <url>` | `ws://127.0.0.1:4501` | App-server address to connect to |
| `--auth-token-env <VAR>` | _(none)_ | Read Bearer token from this env var |
| `-j`, `--json` | `false` | Emit ThreadEvent JSONL to stdout |
| `--timeout <sec>` | `300` | Max wait time in seconds |
| `--codex-bin <path>` | `codex` | Path to codex binary |

---

## How it works

```
┌─────────────────────────────────────────────────────┐
│                 codex-exec-remote                    │
│                                                     │
│  argv → parseArgs → WebSocket connect               │
│  → initialize handshake                              │
│  → thread/start or thread/resume                     │
│  → turn/start → event loop (notifications)           │
│  → thread/read (canonical output) → stdout           │
└──────────────────────┬──────────────────────────────┘
                       │ JSON-RPC 2.0 over WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│              codex app-server                        │
│              (ws://127.0.0.1:4501)                   │
└─────────────────────────────────────────────────────┘
```

1. Connects to `codex app-server` via WebSocket (with optional `Authorization` header)
2. Performs JSON-RPC `initialize` / `initialized` handshake
3. Creates or resumes a thread, then starts a turn with the user prompt
4. Streams `item/agentMessage/delta` notifications to stderr (human mode)
5. On `turn/completed`, reads `thread/read(includeTurns=true)` for the canonical assistant response
6. Prints the final response to stdout; exits with appropriate code

**Non-interactive, full-permission.** All server requests (command execution, file changes) are auto-approved.

---

## Notes

- Default mode (no subcommand) launches `codex app-server`.
- `start` creates a new thread via `thread/start`, then sends a turn.
- `resume --last` uses `thread/list` sorted by `updated_at` to find the most recent thread.
- `thread/read(includeTurns=true)` is the canonical source for the final assistant output.
- All server requests (command execution, file changes, approvals) are **auto-approved** — equivalent to `codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check`.
- JSON mode emits `codex exec --json` compatible ThreadEvent JSONL (`thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`, etc.).

---

## Contributors

This project was built together with AI agents.

| | Role |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | Design, direction, verification |
| **[Antigravity](https://antigravity.google)** | Implementation, architecture |
| **[Codex](https://openai.com/codex)** | Implementation, code review |

---

## License

MIT
