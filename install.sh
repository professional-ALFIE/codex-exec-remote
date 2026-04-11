#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEX_EXEC_REMOTE_REPO_URL:-https://github.com/professional-ALFIE/codex-exec-remote.git}"
INSTALL_ROOT="${CODEX_EXEC_REMOTE_HOME:-$HOME/.codex-exec-remote}"
SOURCE_DIR="${CODEX_EXEC_REMOTE_SOURCE_DIR:-$INSTALL_ROOT/source}"
BIN_DIR="${CODEX_EXEC_REMOTE_BIN_DIR:-$HOME/bin}"
BIN_NAME="codex-exec-remote"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing required command: $1" >&2
    exit 1
  fi
}

echo "[1/6] Checking prerequisites..."
require_cmd git
require_cmd bun

mkdir -p "$INSTALL_ROOT"

if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[2/6] Updating existing source checkout..."
  git -C "$SOURCE_DIR" remote set-url origin "$REPO_URL"
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout -B master origin/master
  git -C "$SOURCE_DIR" reset --hard origin/master
  git -C "$SOURCE_DIR" clean -fd
else
  echo "[2/6] Cloning source..."
  rm -rf "$SOURCE_DIR"
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

echo "[3/6] Installing dependencies..."
cd "$SOURCE_DIR"
bun install --frozen-lockfile || bun install

echo "[4/6] Building binary..."
bun run build

echo "[5/6] Linking executable..."
mkdir -p "$BIN_DIR"
ln -sf "$SOURCE_DIR/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
ln -sf "$SOURCE_DIR/$BIN_NAME" "$BIN_DIR/cer"

echo "[6/6] Verifying installation..."
"$BIN_DIR/$BIN_NAME" --help >/dev/null

echo
echo "Installed $BIN_NAME"
echo "  source: $SOURCE_DIR"
echo "  binary: $BIN_DIR/$BIN_NAME"

PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
MARKER="# Added by codex-exec-remote installer"

add_to_profile() {
  local profile="$1"
  if [ ! -f "$profile" ]; then
    return
  fi
  if grep -qF "$BIN_DIR" "$profile" 2>/dev/null; then
    echo "  PATH: already in $profile"
    return
  fi
  echo "" >> "$profile"
  echo "$MARKER" >> "$profile"
  echo "$PATH_LINE" >> "$profile"
  echo "  PATH: added to $profile"
}

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "  PATH: ok"
    ;;
  *)
    # Ensure profiles exist for the current shell at minimum
    SHELL_NAME="$(basename "${SHELL:-/bin/zsh}")"
    if [ "$SHELL_NAME" = "zsh" ]; then
      touch "$HOME/.zshrc"
    fi

    # Add to all common shell profiles that exist
    add_to_profile "$HOME/.zshrc"
    add_to_profile "$HOME/.bashrc"
    add_to_profile "$HOME/.bash_profile"
    add_to_profile "$HOME/.profile"

    export PATH="$BIN_DIR:$PATH"
    echo "  PATH: active in current session"
    ;;
esac

