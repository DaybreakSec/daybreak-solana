#!/usr/bin/env bash
set -euo pipefail

# run.sh - Run ast-grep with Solana-specific rules
# Usage: ./run.sh <target-directory>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES_DIR="$SCRIPT_DIR/rules"

usage() {
    echo "Usage: $0 <target-directory>" >&2
    exit 1
}

if [[ $# -lt 1 ]]; then
    usage
fi

TARGET_DIR="$(realpath "$1")"

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Error: Directory '$TARGET_DIR' does not exist." >&2
    exit 1
fi

# Determine ast-grep command name (could be 'ast-grep' or 'sg')
AST_GREP_CMD=""
if command -v ast-grep &>/dev/null; then
    AST_GREP_CMD="ast-grep"
elif command -v sg &>/dev/null; then
    AST_GREP_CMD="sg"
else
    echo "Error: Neither 'ast-grep' nor 'sg' found in PATH." >&2
    echo "Install ast-grep: npm install -g @ast-grep/cli" >&2
    echo "[]"
    exit 0
fi

if [[ ! -d "$RULES_DIR" ]]; then
    echo "Error: Rules directory '$RULES_DIR' does not exist." >&2
    echo "[]"
    exit 0
fi

# Collect all results
ALL_RESULTS="["
FIRST=true

for rule_file in "$RULES_DIR"/*.yml "$RULES_DIR"/*.yaml; do
    # Skip if no files match the glob
    [[ -e "$rule_file" ]] || continue

    rule_name=$(basename "$rule_file" | sed 's/\.\(yml\|yaml\)$//')

    # Run ast-grep scan with this rule
    result=$($AST_GREP_CMD scan \
        --rule "$rule_file" \
        --json \
        "$TARGET_DIR" 2>/dev/null) || true

    if [[ -z "$result" ]] || [[ "$result" == "[]" ]] || [[ "$result" == "null" ]]; then
        continue
    fi

    # Parse each match from the JSON array and normalize
    # Pipe result via stdin instead of shell interpolation to avoid injection
    normalized=$(echo "$result" | python3 -c "
import json, sys

try:
    matches = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if not isinstance(matches, list):
    sys.exit(0)

rule_name = sys.argv[1] if len(sys.argv) > 1 else 'unknown'

for m in matches:
    entry = {
        'rule': rule_name,
        'id': m.get('ruleId', rule_name),
        'severity': m.get('severity', 'warning'),
        'message': m.get('message', ''),
        'file': m.get('file', ''),
        'line': m.get('range', {}).get('start', {}).get('line', 0),
        'snippet': m.get('text', '')[:200],
    }
    print(json.dumps(entry))
" "$rule_name" 2>/dev/null) || true

    # Append each line as an element
    while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        if [[ "$FIRST" == "true" ]]; then
            FIRST=false
        else
            ALL_RESULTS+=","
        fi
        ALL_RESULTS+="$entry"
    done <<< "$normalized"
done

ALL_RESULTS+="]"

echo "$ALL_RESULTS"
