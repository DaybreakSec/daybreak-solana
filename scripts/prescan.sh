#!/usr/bin/env bash
set -euo pipefail

# prescan.sh - Orchestrate all static analysis tools with graceful fallback
# Usage: ./prescan.sh <target-directory> <output-directory>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_activate-venv.sh"

usage() {
    echo "Usage: $0 <target-directory> <output-directory>" >&2
    exit 1
}

if [[ $# -lt 2 ]]; then
    usage
fi

TARGET_DIR="$(realpath "$1")"
OUTPUT_DIR="$(realpath "$2" 2>/dev/null || echo "$2")"

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Error: Target directory '$TARGET_DIR' does not exist." >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Logging & tool status tracking
# ---------------------------------------------------------------------------
log() {
    echo "[prescan] $(date '+%H:%M:%S') $*" >&2
}

# Track which tools ran, skipped, or failed
declare -A TOOL_STATUS

tool_ok() {
    TOOL_STATUS["$1"]="ok"
    log "$1: completed"
}

tool_skip() {
    TOOL_STATUS["$1"]="skipped: $2"
    log "$1: skipped ($2)"
}

tool_fail() {
    TOOL_STATUS["$1"]="failed: $2"
    log "WARNING: $1 failed ($2)"
}

# ---------------------------------------------------------------------------
# Initialize output files
# ---------------------------------------------------------------------------
LEADS_FILE="$OUTPUT_DIR/leads.json"
AST_GREP_FILE="$OUTPUT_DIR/ast-grep-results.json"
CLIPPY_FILE="$OUTPUT_DIR/clippy-results.json"
AUDIT_FILE="$OUTPUT_DIR/cargo-audit-results.json"
ACCOUNTS_FILE="$OUTPUT_DIR/accounts.json"
CPIS_FILE="$OUTPUT_DIR/cpis.json"
PDAS_FILE="$OUTPUT_DIR/pdas.json"
INSTRUCTIONS_FILE="$OUTPUT_DIR/instructions.json"
MIR_FILE="$OUTPUT_DIR/mir-results.json"
ORACLES_FILE="$OUTPUT_DIR/oracles.json"
STATE_MACHINES_FILE="$OUTPUT_DIR/state-machines.json"
CLOSE_PATTERNS_FILE="$OUTPUT_DIR/close-patterns.json"
VALUE_FLOWS_FILE="$OUTPUT_DIR/value-flows.json"
AUTH_PATTERNS_FILE="$OUTPUT_DIR/auth-patterns.json"

# Initialize with empty arrays
echo '[]' > "$AST_GREP_FILE"
echo '[]' > "$CLIPPY_FILE"
echo '[]' > "$AUDIT_FILE"
echo '[]' > "$ACCOUNTS_FILE"
echo '[]' > "$CPIS_FILE"
echo '[]' > "$PDAS_FILE"
echo '[]' > "$INSTRUCTIONS_FILE"
echo '[]' > "$MIR_FILE"
echo '[]' > "$ORACLES_FILE"
echo '[]' > "$STATE_MACHINES_FILE"
echo '[]' > "$CLOSE_PATTERNS_FILE"
echo '[]' > "$VALUE_FLOWS_FILE"
echo '[]' > "$AUTH_PATTERNS_FILE"

# ---------------------------------------------------------------------------
# 1. ast-grep analysis
# ---------------------------------------------------------------------------
run_ast_grep() {
    if ! command -v ast-grep &>/dev/null && ! command -v sg &>/dev/null; then
        tool_skip "ast-grep" "binary not found"
        return 0
    fi

    local ast_grep_script="$SCRIPT_DIR/ast-grep/run.sh"
    if [[ -x "$ast_grep_script" ]]; then
        log "Running ast-grep rules..."
        local result
        if result=$("$ast_grep_script" "$TARGET_DIR" 2>&1); then
            if [[ -n "$result" && "$result" != "[]" ]]; then
                echo "$result" > "$AST_GREP_FILE"
            fi
            tool_ok "ast-grep"
        else
            tool_fail "ast-grep" "run.sh exited with non-zero"
        fi
    else
        tool_skip "ast-grep" "run.sh not found or not executable"
    fi
}

# ---------------------------------------------------------------------------
# 2. cargo clippy
# ---------------------------------------------------------------------------
run_clippy() {
    if ! command -v cargo &>/dev/null; then
        tool_skip "clippy" "cargo not found"
        return 0
    fi

    if [[ ! -f "$TARGET_DIR/Cargo.toml" ]]; then
        tool_skip "clippy" "no Cargo.toml"
        return 0
    fi

    log "Running cargo clippy..."
    local clippy_output clippy_exit=0
    clippy_output=$(cd "$TARGET_DIR" && cargo clippy --message-format=json 2>&1) || clippy_exit=$?

    if [[ $clippy_exit -ne 0 && -z "$clippy_output" ]]; then
        tool_fail "clippy" "exit code $clippy_exit"
        return 0
    fi

    if [[ -n "$clippy_output" ]]; then
        # Extract warning/error messages into JSON array
        if echo "$clippy_output" | python3 -c "
import sys, json
results = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
        if msg.get('reason') == 'compiler-message':
            cm = msg.get('message', {})
            results.append({
                'tool': 'clippy',
                'severity': cm.get('level', 'warning'),
                'message': cm.get('message', ''),
                'code': cm.get('code', {}).get('code', '') if cm.get('code') else '',
                'spans': [
                    {
                        'file': s.get('file_name', ''),
                        'line_start': s.get('line_start', 0),
                        'line_end': s.get('line_end', 0),
                    }
                    for s in cm.get('spans', [])
                ],
            })
    except json.JSONDecodeError:
        continue
json.dump(results, sys.stdout, indent=2)
" > "$CLIPPY_FILE" 2>/dev/null; then
            tool_ok "clippy"
        else
            echo '[]' > "$CLIPPY_FILE"
            tool_fail "clippy" "JSON parsing failed"
        fi
    else
        tool_ok "clippy"
    fi
}

# ---------------------------------------------------------------------------
# 3. cargo audit
# ---------------------------------------------------------------------------
run_cargo_audit() {
    if ! command -v cargo-audit &>/dev/null && ! command -v cargo &>/dev/null; then
        tool_skip "cargo-audit" "binary not found"
        return 0
    fi

    if [[ ! -f "$TARGET_DIR/Cargo.lock" ]]; then
        tool_skip "cargo-audit" "no Cargo.lock"
        return 0
    fi

    log "Running cargo audit..."
    local audit_output audit_exit=0
    audit_output=$(cd "$TARGET_DIR" && cargo audit --json 2>&1) || audit_exit=$?

    if [[ -n "$audit_output" ]]; then
        if echo "$audit_output" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    vulns = data.get('vulnerabilities', {}).get('list', [])
    results = []
    for v in vulns:
        adv = v.get('advisory', {})
        results.append({
            'tool': 'cargo-audit',
            'id': adv.get('id', ''),
            'package': adv.get('package', ''),
            'title': adv.get('title', ''),
            'severity': adv.get('cvss', ''),
            'url': adv.get('url', ''),
        })
    json.dump(results, sys.stdout, indent=2)
except Exception as e:
    print(f'Parse error: {e}', file=sys.stderr)
    json.dump([], sys.stdout)
" > "$AUDIT_FILE" 2>/dev/null; then
            tool_ok "cargo-audit"
        else
            echo '[]' > "$AUDIT_FILE"
            tool_fail "cargo-audit" "JSON parsing failed"
        fi
    else
        tool_skip "cargo-audit" "no output"
    fi
}

# ---------------------------------------------------------------------------
# 4. tree-sitter Python extractors
# ---------------------------------------------------------------------------
run_tree_sitter() {
    if ! command -v python3 &>/dev/null; then
        tool_skip "tree-sitter" "python3 not found"
        return 0
    fi

    # Check if tree-sitter is available
    if ! python3 -c "import tree_sitter" 2>/dev/null; then
        tool_skip "tree-sitter" "tree-sitter Python module not available"
        return 0
    fi

    local ts_dir="$SCRIPT_DIR/tree-sitter"
    local ts_failed=0

    local extractors=(
        "extract-accounts.py:$ACCOUNTS_FILE:accounts"
        "extract-cpis.py:$CPIS_FILE:cpis"
        "extract-pdas.py:$PDAS_FILE:pdas"
        "extract-instructions.py:$INSTRUCTIONS_FILE:instructions"
        "extract-oracles.py:$ORACLES_FILE:oracles"
        "extract-state-machines.py:$STATE_MACHINES_FILE:state-machines"
        "extract-close-patterns.py:$CLOSE_PATTERNS_FILE:close-patterns"
        "extract-value-flows.py:$VALUE_FLOWS_FILE:value-flows"
        "extract-auth-patterns.py:$AUTH_PATTERNS_FILE:auth-patterns"
    )

    for entry in "${extractors[@]}"; do
        IFS=':' read -r script outfile label <<< "$entry"
        if [[ -f "$ts_dir/$script" ]]; then
            log "Extracting $label..."
            if python3 "$ts_dir/$script" "$TARGET_DIR" > "$outfile" 2>/dev/null; then
                # Validate output is valid JSON
                if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$outfile" 2>/dev/null; then
                    echo '[]' > "$outfile"
                    tool_fail "tree-sitter:$label" "invalid JSON output"
                    ts_failed=1
                fi
            else
                echo '[]' > "$outfile"
                tool_fail "tree-sitter:$label" "script exited with non-zero"
                ts_failed=1
            fi
        fi
    done

    if [[ $ts_failed -eq 0 ]]; then
        tool_ok "tree-sitter"
    fi
}

# ---------------------------------------------------------------------------
# 5. MIR analysis
# ---------------------------------------------------------------------------
run_mir() {
    local mir_dir="$SCRIPT_DIR/mir"

    if [[ ! -x "$mir_dir/emit-mir.sh" ]]; then
        tool_skip "mir" "emit-mir.sh not found or not executable"
        return 0
    fi

    if ! command -v cargo &>/dev/null; then
        tool_skip "mir" "cargo not found"
        return 0
    fi

    log "Emitting MIR..."
    local mir_output_dir="$OUTPUT_DIR/mir-output"
    mkdir -p "$mir_output_dir"
    if ! "$mir_dir/emit-mir.sh" "$TARGET_DIR" "$mir_output_dir" 2>/dev/null; then
        tool_fail "mir" "emit-mir.sh failed"
        # Continue to parse whatever was produced
    fi

    if [[ -f "$mir_dir/parse-mir.py" ]] && command -v python3 &>/dev/null; then
        log "Parsing MIR..."
        if python3 "$mir_dir/parse-mir.py" "$mir_output_dir" > "$MIR_FILE" 2>/dev/null; then
            tool_ok "mir"
        else
            echo '[]' > "$MIR_FILE"
            tool_fail "mir" "parse-mir.py failed"
        fi
    else
        tool_skip "mir" "parse-mir.py or python3 not available"
    fi
}

# ---------------------------------------------------------------------------
# 6. Merge all outputs into leads.json
# ---------------------------------------------------------------------------
merge_results() {
    log "Merging results into leads.json..."

    # Build tool status JSON from bash associative array
    local status_json="{"
    local status_first=true
    for tool in "${!TOOL_STATUS[@]}"; do
        if [[ "$status_first" == "true" ]]; then
            status_first=false
        else
            status_json+=","
        fi
        # Escape the value for JSON
        local val="${TOOL_STATUS[$tool]}"
        val="${val//\\/\\\\}"
        val="${val//\"/\\\"}"
        status_json+="\"$tool\":\"$val\""
    done
    status_json+="}"

    python3 -c "
import json, sys

def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default

ast_grep = load_json(sys.argv[1], [])
clippy = load_json(sys.argv[2], [])
audit = load_json(sys.argv[3], [])
mir = load_json(sys.argv[4], [])
accounts = load_json(sys.argv[5], [])
cpis = load_json(sys.argv[6], [])
pdas = load_json(sys.argv[7], [])
instructions = load_json(sys.argv[8], [])
tool_status = json.loads(sys.argv[9])

# Combine all tool findings into leads
leads = []

# ast-grep results
for item in ast_grep:
    leads.append({
        'source': 'ast-grep',
        'rule': item.get('rule', item.get('id', '')),
        'severity': item.get('severity', 'warning'),
        'message': item.get('message', ''),
        'file': item.get('file', ''),
        'line': item.get('line', 0),
        'snippet': item.get('snippet', ''),
    })

# clippy results
for item in clippy:
    leads.append({
        'source': 'clippy',
        'rule': item.get('code', ''),
        'severity': item.get('severity', 'warning'),
        'message': item.get('message', ''),
        'file': item.get('spans', [{}])[0].get('file', '') if item.get('spans') else '',
        'line': item.get('spans', [{}])[0].get('line_start', 0) if item.get('spans') else 0,
        'snippet': '',
    })

# cargo-audit results
for item in audit:
    leads.append({
        'source': 'cargo-audit',
        'rule': item.get('id', ''),
        'severity': 'high',
        'message': item.get('title', ''),
        'file': 'Cargo.toml',
        'line': 0,
        'snippet': item.get('package', ''),
    })

# MIR results
for item in mir:
    leads.append({
        'source': 'mir',
        'rule': item.get('type', ''),
        'severity': item.get('severity', 'warning'),
        'message': item.get('message', ''),
        'file': item.get('file', ''),
        'line': item.get('line', 0),
        'snippet': item.get('snippet', ''),
    })

output = {
    'leads': leads,
    'toolStatus': tool_status,
    'accounts': accounts,
    'cpis': cpis,
    'pdas': pdas,
    'instructions': instructions,
}

json.dump(output, sys.stdout, indent=2)
" "$AST_GREP_FILE" "$CLIPPY_FILE" "$AUDIT_FILE" "$MIR_FILE" \
  "$ACCOUNTS_FILE" "$CPIS_FILE" "$PDAS_FILE" "$INSTRUCTIONS_FILE" \
  "$status_json" > "$LEADS_FILE"

    log "Results written to $LEADS_FILE"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "Starting prescan of $TARGET_DIR"
    log "Output directory: $OUTPUT_DIR"

    run_ast_grep
    run_clippy
    run_cargo_audit
    run_tree_sitter
    run_mir
    merge_results

    # Print tool status summary
    log "--- Prescan Summary ---"
    local has_failures=false
    for tool in "${!TOOL_STATUS[@]}"; do
        local status="${TOOL_STATUS[$tool]}"
        if [[ "$status" == failed* ]]; then
            log "  FAIL  $tool: $status"
            has_failures=true
        elif [[ "$status" == skipped* ]]; then
            log "  SKIP  $tool: $status"
        else
            log "  OK    $tool"
        fi
    done

    if [[ "$has_failures" == "true" ]]; then
        log "WARNING: Some tools failed. Results may be incomplete."
    fi

    log "Prescan complete"
    echo "$LEADS_FILE"
}

main
