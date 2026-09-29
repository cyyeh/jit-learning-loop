#!/usr/bin/env bash
# Symlink the skill into an agent's skills directory, so edits in this repo
# take effect immediately (no reinstall needed).
#
#   ./scripts/install.sh               # Claude Code: ${CLAUDE_CONFIG_DIR:-~/.claude}/skills
#   ./scripts/install.sh <skills-dir>  # any other agent's skills directory
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/skills/jit-learning-loop"
dest_dir="${1:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills}"
dest="$dest_dir/jit-learning-loop"

mkdir -p "$dest_dir"

if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "error: $dest exists and is not a symlink; remove it first" >&2
  exit 1
fi

ln -sfn "$src" "$dest"
echo "linked $dest -> $src"
