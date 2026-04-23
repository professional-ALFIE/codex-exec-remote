#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEX_EXEC_REMOTE_REPO_URL:-https://github.com/professional-ALFIE/codex-exec-remote.git}"
INSTALL_ROOT="${CODEX_EXEC_REMOTE_HOME:-$HOME/.codex-exec-remote}"
SOURCE_DIR="${CODEX_EXEC_REMOTE_SOURCE_DIR:-$INSTALL_ROOT/source}"
# Optional launcher target override. When unset, the installer chooses a directory
# from the clean noninteractive bash PATH instead of assuming ~/bin is usable.
REQUESTED_BIN_DIR="${CODEX_EXEC_REMOTE_BIN_DIR:-}"
# Test hook to inject a deterministic clean PATH. In real installs we derive this
# from `env -i HOME="$HOME" /bin/bash -c 'printf "%s" "$PATH"'`.
CLEAN_PATH_OVERRIDE="${CODEX_EXEC_REMOTE_CLEAN_PATH:-}"
BIN_NAME="codex-exec-remote"
ALIAS_NAME="cer"
# The compiled binary is copied into a managed runtime location under INSTALL_ROOT.
# Launchers point here so runtime no longer depends on the git checkout path.
MANAGED_DIR="$INSTALL_ROOT/runtime"
MANAGED_BIN_PATH="$MANAGED_DIR/$BIN_NAME"
# The launcher records the codex binary here so plain `cer` keeps working even
# when `/bin/bash -c` cannot discover `codex` through PATH.
DEFAULT_CODEX_ENV="CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing required command: $1" >&2
    exit 1
  fi
}

resolve_command_path() {
  local raw="$1"
  local resolved=""

  if [ -z "$raw" ]; then
    return 1
  fi

  case "$raw" in
    */*)
      if [ ! -x "$raw" ]; then
        echo "[error] Command is not executable: $raw" >&2
        exit 1
      fi
      resolved="$raw"
      ;;
    *)
      resolved="$(command -v "$raw" 2>/dev/null || true)"
      if [ -z "$resolved" ]; then
        return 1
      fi
      ;;
  esac

  printf '%s\n' "$resolved"
}

quote_sh() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\"'\"'/g")"
}

path_contains_dir() {
  local path_value="$1"
  local dir="$2"
  case ":$path_value:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

can_install_to_dir() {
  local dir="$1"
  local parent

  if [ -d "$dir" ]; then
    [ -w "$dir" ]
    return
  fi

  parent="$(dirname "$dir")"
  [ -d "$parent" ] && [ -w "$parent" ]
}

get_clean_path() {
  if [ -n "$CLEAN_PATH_OVERRIDE" ]; then
    printf '%s\n' "$CLEAN_PATH_OVERRIDE"
    return
  fi

  # Derive the PATH that a minimal `/bin/bash -c` sees. This is the environment
  # that previously failed to find `cer` after install because ~/.zshrc and
  # similar interactive profiles are not consulted there.
  env -i HOME="$HOME" /bin/bash -c 'printf "%s" "$PATH"'
}

join_with_colon() {
  local IFS=":"
  printf '%s' "$*"
}

choose_bin_dir() {
  local clean_path="$1"
  local candidate
  local remaining_path

  if [ -n "$REQUESTED_BIN_DIR" ]; then
    printf '%s\n' "$REQUESTED_BIN_DIR"
    return
  fi

  # Walk the clean PATH from left to right and pick the first writable absolute
  # directory. We intentionally ignore relative entries such as "." or "./bin"
  # so automatic installation stays predictable and does not depend on cwd.
  remaining_path="$clean_path"
  while :; do
    case "$remaining_path" in
      *:*)
        candidate="${remaining_path%%:*}"
        remaining_path="${remaining_path#*:}"
        ;;
      *)
        candidate="$remaining_path"
        remaining_path=""
        ;;
    esac

    if [ -n "$candidate" ] && [ "$candidate" != "." ]; then
      case "$candidate" in
        /*)
          if can_install_to_dir "$candidate"; then
            printf '%s\n' "$candidate"
            return
          fi
          ;;
      esac
    fi

    if [ -z "$remaining_path" ]; then
      break
    fi
  done

  echo "[error] No writable install directory was found on the default noninteractive PATH." >&2
  echo "        clean PATH: $clean_path" >&2
  echo "        Set CODEX_EXEC_REMOTE_BIN_DIR to a writable directory on that PATH." >&2
  exit 1
}

run_clean_shell() {
  local clean_path="$1"
  local command="$2"
  # Execute verification against the same kind of clean shell that Antigravity
  # uses. Verifying only the current interactive shell would miss the original
  # failure mode where `/bin/bash -c` could not discover installed launchers.
  env -i HOME="$HOME" /bin/bash -c "PATH=$(quote_sh "$clean_path"); $command"
}

verify_help_command() {
  local clean_path="$1"
  local executable_name="$2"
  run_clean_shell "$clean_path" "command -v $executable_name >/dev/null && $executable_name --help >/dev/null"
}

verify_direct_help() {
  local executable_path="$1"
  "$executable_path" --help >/dev/null
}

add_to_profile() {
  local profile="$1"
  local path_line="$2"
  local marker="$3"

  if [ ! -f "$profile" ]; then
    return
  fi

  if grep -qF "$path_line" "$profile" 2>/dev/null; then
    echo "  PATH: already in $profile"
    return
  fi

  echo "" >> "$profile"
  echo "$marker" >> "$profile"
  echo "$path_line" >> "$profile"
  echo "  PATH: added to $profile"
}

install_profile_path() {
  local bin_dir="$1"
  local path_line="export PATH=\"$bin_dir:\$PATH\""
  local marker="# Added by codex-exec-remote installer"
  local shell_name

  shell_name="$(basename "${SHELL:-/bin/zsh}")"
  touch "$HOME/.profile"
  case "$shell_name" in
    zsh)
      touch "$HOME/.zshrc"
      ;;
    bash)
      touch "$HOME/.bashrc"
      ;;
  esac

  add_to_profile "$HOME/.zshrc" "$path_line" "$marker"
  add_to_profile "$HOME/.bashrc" "$path_line" "$marker"
  add_to_profile "$HOME/.bash_profile" "$path_line" "$marker"
  add_to_profile "$HOME/.profile" "$path_line" "$marker"
}

write_wrapper() {
  local wrapper_path="$1"
  local managed_bin_path="$2"
  local default_codex_bin="$3"
  local runtime_path_prefix="$4"
  local managed_bin_q
  local default_codex_q
  local runtime_path_q

  managed_bin_q="$(quote_sh "$managed_bin_path")"
  default_codex_q="$(quote_sh "$default_codex_bin")"
  runtime_path_q="$(quote_sh "$runtime_path_prefix")"

  {
    echo "#!/bin/sh"
    echo "set -eu"
    # Preserve runtime dependencies such as `node` and the directory containing
    # the pinned `codex` binary. This keeps the launcher self-sufficient in a
    # clean shell where those paths may be absent from PATH.
    if [ -n "$runtime_path_prefix" ]; then
      echo "PATH=$runtime_path_q:\${PATH:-}"
    fi
    echo "export PATH"
    # Record the codex binary path in an env var that src/index.ts reads as the
    # default. This avoids argv rewriting and fixes the case where plain `cer`
    # launches serve mode but clean `/bin/bash -c` cannot find `codex`.
    echo ": \${$DEFAULT_CODEX_ENV:=$default_codex_q}"
    echo "export $DEFAULT_CODEX_ENV"
    echo "exec $managed_bin_q \"\$@\""
  } > "$wrapper_path"

  chmod 755 "$wrapper_path"
}

build_runtime_command() {
  local default_codex_bin="$1"
  local runtime_path_prefix="$2"
  local command=""

  if [ -n "$runtime_path_prefix" ]; then
    command="PATH=$(quote_sh "$runtime_path_prefix"):\${PATH:-}; "
  fi

  # Install success is not just "launcher can print --help". We also verify that
  # the pinned codex binary can execute `app-server --help` from the same clean
  # shell, which protects the default `cer` serve path.
  command="${command}export PATH; $(quote_sh "$default_codex_bin") app-server --help >/dev/null"
  printf '%s\n' "$command"
}

echo "[1/7] Checking prerequisites..."
require_cmd git
require_cmd bun

RESOLVED_CODEX_BIN="$(resolve_command_path "${!DEFAULT_CODEX_ENV:-codex}" || true)"
if [ -z "$RESOLVED_CODEX_BIN" ]; then
  echo "[error] Missing required command: codex" >&2
  echo "        Install Codex CLI first or set $DEFAULT_CODEX_ENV to an absolute path." >&2
  exit 1
fi

RESOLVED_NODE_BIN="$(resolve_command_path "node" || true)"

CLEAN_PATH="$(get_clean_path)"
BIN_DIR="$(choose_bin_dir "$CLEAN_PATH")"

# Build a minimal PATH prefix that the launcher can prepend before exec.
# This is narrower than exporting the full interactive PATH and captures only
# what is required for the managed binary and the pinned codex shim to run.
RUNTIME_PATH_DIRS=()
for candidate in \
  "${RESOLVED_NODE_BIN:+$(dirname "$RESOLVED_NODE_BIN")}" \
  "${RESOLVED_CODEX_BIN:+$(dirname "$RESOLVED_CODEX_BIN")}"; do
  if [ -z "$candidate" ] || [ "$candidate" = "." ]; then
    continue
  fi

  already_present=0
  for existing in "${RUNTIME_PATH_DIRS[@]:-}"; do
    if [ "$existing" = "$candidate" ]; then
      already_present=1
      break
    fi
  done

  if [ "$already_present" -eq 0 ]; then
    RUNTIME_PATH_DIRS+=("$candidate")
  fi
done

RUNTIME_PATH_PREFIX="$(join_with_colon "${RUNTIME_PATH_DIRS[@]:-}")"
BIN_DIR_ON_CLEAN_PATH=0
if path_contains_dir "$CLEAN_PATH" "$BIN_DIR"; then
  BIN_DIR_ON_CLEAN_PATH=1
fi

mkdir -p "$INSTALL_ROOT"

if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[2/7] Updating existing source checkout..."
  git -C "$SOURCE_DIR" remote set-url origin "$REPO_URL"
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout -B master origin/master
  git -C "$SOURCE_DIR" reset --hard origin/master
  git -C "$SOURCE_DIR" clean -fd
else
  echo "[2/7] Cloning source..."
  rm -rf "$SOURCE_DIR"
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

echo "[3/7] Installing dependencies..."
cd "$SOURCE_DIR"
bun install --frozen-lockfile || bun install

echo "[4/7] Building binary..."
bun run build

echo "[5/7] Installing managed runtime..."
mkdir -p "$MANAGED_DIR"
tmp_managed_bin="$MANAGED_BIN_PATH.tmp"
# Copy the compiled binary into a stable runtime path first. Launchers target
# this file instead of the git checkout so `git clean -fd` or checkout changes
# do not break the installed command location.
cp "$SOURCE_DIR/$BIN_NAME" "$tmp_managed_bin"
chmod 755 "$tmp_managed_bin"
mv "$tmp_managed_bin" "$MANAGED_BIN_PATH"

echo "[6/7] Installing launchers..."
mkdir -p "$BIN_DIR"
# Install tiny shell launchers in the user-visible bin directory. These launchers
# keep `cer`/`codex-exec-remote` discoverable on clean PATH while delegating the
# actual runtime to MANAGED_BIN_PATH.
write_wrapper "$BIN_DIR/$BIN_NAME" "$MANAGED_BIN_PATH" "$RESOLVED_CODEX_BIN" "$RUNTIME_PATH_PREFIX"
ln -sfn "$BIN_NAME" "$BIN_DIR/$ALIAS_NAME"

if [ "$BIN_DIR_ON_CLEAN_PATH" -eq 0 ]; then
  if [ -n "$REQUESTED_BIN_DIR" ]; then
    echo "  PATH: $BIN_DIR is not on the default noninteractive PATH"
    install_profile_path "$BIN_DIR"
    export PATH="$BIN_DIR:$PATH"
    echo "  PATH: active in current session"
  else
    echo "[error] Selected install directory is not on the default noninteractive PATH: $BIN_DIR" >&2
    echo "        clean PATH: $CLEAN_PATH" >&2
    exit 1
  fi
else
  echo "  PATH: clean shell default includes $BIN_DIR"
fi

echo "[7/7] Verifying installation..."
if [ "$BIN_DIR_ON_CLEAN_PATH" -eq 1 ]; then
  # This is the critical regression check for the original bug: a bare command
  # must resolve and print help inside a clean `/bin/bash -c` environment.
  verify_help_command "$CLEAN_PATH" "$BIN_NAME"
  verify_help_command "$CLEAN_PATH" "$ALIAS_NAME"
else
  # When the user forces a custom launcher dir outside clean PATH, we still make
  # the launcher executable and update interactive profiles, but we do not claim
  # bare-command availability in clean noninteractive shells.
  verify_direct_help "$BIN_DIR/$BIN_NAME"
  verify_direct_help "$BIN_DIR/$ALIAS_NAME"
fi

verify_codex_runtime_command="$(build_runtime_command "$RESOLVED_CODEX_BIN" "$RUNTIME_PATH_PREFIX")"
run_clean_shell "$CLEAN_PATH" "$verify_codex_runtime_command"

echo
echo "Installed $BIN_NAME"
echo "  source: $SOURCE_DIR"
echo "  managed binary: $MANAGED_BIN_PATH"
echo "  launcher: $BIN_DIR/$BIN_NAME"
echo "  alias: $BIN_DIR/$ALIAS_NAME"
echo "  clean PATH: $CLEAN_PATH"
if [ "$BIN_DIR_ON_CLEAN_PATH" -eq 0 ]; then
  echo "  note: bare commands are available for interactive shells after profile reload"
fi
