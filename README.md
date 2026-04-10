# codex-exec-remote

> **Run commands on a Codex app-server session from the terminal.**
>
> The stock `codex exec` cannot connect to a running `codex app-server`. This tool can.

- [Releases](https://github.com/professional-ALFIE/codex-exec-remote/releases)
- [한국어](./README.ko.md)

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

`codex exec` runs a one-shot prompt locally. It **cannot** attach to a running `codex app-server` instance — no `--remote`, no session resume, no multi-client sync.

`codex-exec-remote` fills that gap:

| | `codex exec` | `codex-exec-remote` |
|---|---|---|
| Connect to app-server | ✗ | ✓ |
| Resume existing thread | ✗ | ✓ (`resume`) |
| Start new thread remotely | ✗ | ✓ (`start`) |
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
| `codex-exec-remote` | **Launch** `codex app-server --listen ws://127.0.0.1:4501` |
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
- Links `codex-exec-remote` into `~/.local/bin`
- Verifies the install with `codex-exec-remote --help`

**Required:** macOS or Linux, [Codex CLI](https://github.com/openai/codex) installed, Git, [Bun](https://bun.sh)

> **Update?** Just run the same command again.

### Via Bun (global)

```bash
bun install -g codex-exec-remote
```

> Requires [Bun](https://bun.sh) runtime at execution time.

### Manual installation

```bash
git clone https://github.com/professional-ALFIE/codex-exec-remote.git ~/.codex-exec-remote/source
cd ~/.codex-exec-remote/source
bun install
bun run build
mkdir -p ~/.local/bin
ln -sf ~/.codex-exec-remote/source/codex-exec-remote ~/.local/bin/codex-exec-remote
```

If `~/.local/bin` is not on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## Usage

```bash
# Launch app-server (default ws://127.0.0.1:4501)
codex-exec-remote

# Launch app-server on custom address
codex-exec-remote --listen ws://127.0.0.1:9999

# Start a new thread
codex-exec-remote start "hello"

# Resume an existing thread
codex-exec-remote resume <thread-id> "hello"

# Resume the most recent thread
codex-exec-remote resume --last "hello"

# JSON output (ThreadEvent JSONL to stdout)
codex-exec-remote start "hello" --json
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
| `--json` | `false` | Emit ThreadEvent JSONL to stdout |
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

**Non-interactive only.** Any server request (approval, user input) is rejected with exit 1.

---

## Notes

- Default mode (no subcommand) launches `codex app-server`.
- `start` creates a new thread via `thread/start`, then sends a turn.
- `resume --last` uses `thread/list` sorted by `updated_at` to find the most recent thread.
- `thread/read(includeTurns=true)` is the canonical source for the final assistant output.
- Interactive server requests are rejected immediately (fail-fast).
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
