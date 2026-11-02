#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

for dependency in overmind tmux npm; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Missing dependency: $dependency" >&2
    echo "Install Overmind and tmux with: brew install overmind tmux" >&2
    echo "Use Node.js 24 or newer with npm." >&2
    exit 1
  fi
done

# Keep the server's configured port rather than Overmind's assigned PORT.
exec overmind start -N "$@"
