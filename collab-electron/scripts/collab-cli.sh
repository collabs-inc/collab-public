#!/bin/bash
# Collaborator CLI - Unix/Linux/macOS
# This script launches the Collaborator Electron app with optional CLI commands

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_APP_DIR="$(dirname "$SCRIPT_DIR")"

# Check if running from installed location or development
if [ -f "$HOME/.local/bin/collab" ]; then
  # Installed location - find the actual app
  if [ -d "$HOME/.local/Collaborator" ]; then
    ELECTRON_APP_DIR="$HOME/.local/Collaborator"
  fi
fi

# Default action: launch the app
launch_app() {
  if command -v electron >/dev/null 2>&1; then
    electron "$ELECTRON_APP_DIR" "$@"
  elif command -v npm >/dev/null 2>&1; then
    cd "$ELECTRON_APP_DIR" && npm run dev "$@"
  else
    echo "Error: Neither 'electron' nor 'npm' found in PATH"
    echo "Please install Node.js and npm to run Collaborator"
    exit 1
  fi
}

# Parse commands
case "${1:-}" in
  ""|start|launch)
    launch_app "${@:2}"
    ;;
  --version|-v)
    echo "Collaborator CLI v0.3.1"
    ;;
  --help|-h)
    echo "Collaborator CLI"
    echo ""
    echo "Usage: collab [command]"
    echo ""
    echo "Commands:"
    echo "  start, launch    Launch the Collaborator app (default)"
    echo "  --version, -v    Show version information"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "If no command is specified, launches the app."
    ;;
  *)
    # Pass through to Electron app
    launch_app "$@"
    ;;
esac
