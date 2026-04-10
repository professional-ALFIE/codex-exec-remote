#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEX_EXEC_REMOTE_REPO_URL:-https://github.com/professional-ALFIE/codex-exec-remote.git}"
INSTALL_ROOT="${CODEX_EXEC_REMOTE_HOME:-$HOME/.codex-exec-remote}"
SOURCE_DIR="${CODEX_EXEC_REMOTE_SOURCE_DIR:-$INSTALL_ROOT/source}"
BIN_DIR="${CODEX_EXEC_REMOTE_BIN_DIR:-$HOME/.local/bin}"
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
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout master >/dev/null 2>&1 || true
  git -C "$SOURCE_DIR" pull --ff-only origin master
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

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "  PATH: ok"
    ;;
  *)
    SHELL_NAME="$(basename "${SHELL:-/bin/zsh}")"
    if [ "$SHELL_NAME" = "zsh" ]; then
      PROFILE="$HOME/.zshrc"
    elif [ "$SHELL_NAME" = "bash" ]; then
      if [ -f "$HOME/.bash_profile" ]; then
        PROFILE="$HOME/.bash_profile"
      else
        PROFILE="$HOME/.bashrc"
      fi
    else
      PROFILE="$HOME/.profile"
    fi

    if ! grep -qF "$BIN_DIR" "$PROFILE" 2>/dev/null; then
      echo "" >> "$PROFILE"
      echo "# Added by codex-exec-remote installer" >> "$PROFILE"
      echo "$PATH_LINE" >> "$PROFILE"
      echo "  PATH: added to $PROFILE"
    else
      echo "  PATH: already in $PROFILE"
    fi

    export PATH="$BIN_DIR:$PATH"
    echo "  PATH: active in current session"
    ;;
esac

