#!/usr/bin/env bash
# _activate-venv.sh - Source this to activate the project .venv if it exists.
# Usage: source "$SCRIPT_DIR/_activate-venv.sh"

_venv_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$_venv_root/.venv/bin/activate" ]]; then
    source "$_venv_root/.venv/bin/activate"
fi
unset _venv_root
