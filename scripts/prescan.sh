#!/usr/bin/env bash
set -euo pipefail

# prescan.sh - Orchestrate all static analysis tools with graceful fallback
# Usage: ./prescan.sh <target-directory> <output-directory>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "[prescan] $(date '+%H:%M:%S') $*" >&2
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

# Initialize with empty arrays
echo '[]' > "$AST_GREP_FILE"
echo '[]' > "$CLIPPY_FILE"
echo '[]' > "$AUDIT_FILE"
echo '[]' > "$ACCOUNTS_FILE"
echo '[]' > "$CPIS_FILE"
echo '[]' > "$PDAS_FILE"
echo '[]' > "$INSTRUCTIONS_FILE"
echo '[]' > "$MIR_FILE"

# ---------------------------------------------------------------------------
# 1. ast-grep analysis
# ---------------------------------------------------------------------------
run_ast_grep() {
    if ! command -v ast-grep &>/dev/null && ! command -v sg &>/dev/null; then
        log "ast-grep not found, skipping"
        return 0
    fi

    local ast_grep_script="$SCRIPT_DIR/ast-grep/run.sh"
    if [[ -x "$ast_grep_script" ]]; then
        log "Running ast-grep rules..."
        local result
        result=$("$ast_grep_script" "$TARGET_DIR" 2>/dev/null) || true
        if [[ -n "$result" ]]; then
            echo "$result" > "$AST_GREP_FILE"
        fi
    else
        log "ast-grep/run.sh not found or not executable, skipping"
    fi
}

# ---------------------------------------------------------------------------
# 2. cargo clippy
# ---------------------------------------------------------------------------
run_clippy() {
    if ! command -v cargo &>/dev/null; then
        log "cargo not found, skipping clippy"
        return 0
    fi

    if [[ ! -f "$TARGET_DIR/Cargo.toml" ]]; then
        log "No Cargo.toml in target, skipping clippy"
        return 0
    fi

    log "Running cargo clippy..."
    local clippy_output
    clippy_output=$(cd "$TARGET_DIR" && cargo clippy --message-format=json 2>/dev/null) || true

    if [[ -n "$clippy_output" ]]; then
        # Extract warning/error messages into JSON array
        echo "$clippy_output" | python3 -c "
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
" > "$CLIPPY_FILE" 2>/dev/null || echo '[]' > "$CLIPPY_FILE"
    fi
}

# ---------------------------------------------------------------------------
# 3. cargo audit
# ---------------------------------------------------------------------------
run_cargo_audit() {
    if ! command -v cargo-audit &>/dev/null && ! command -v cargo &>/dev/null; then
        log "cargo-audit not found, skipping"
        return 0
    fi

    if [[ ! -f "$TARGET_DIR/Cargo.lock" ]]; then
        log "No Cargo.lock in target, skipping audit"
        return 0
    fi

    log "Running cargo audit..."
    local audit_output
    audit_output=$(cd "$TARGET_DIR" && cargo audit --json 2>/dev/null) || true

    if [[ -n "$audit_output" ]]; then
        echo "$audit_output" | python3 -c "
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
except Exception:
    json.dump([], sys.stdout)
" > "$AUDIT_FILE" 2>/dev/null || echo '[]' > "$AUDIT_FILE"
    fi
}

# ---------------------------------------------------------------------------
# 4. tree-sitter Python extractors
# ---------------------------------------------------------------------------
run_tree_sitter() {
    if ! command -v python3 &>/dev/null; then
        log "python3 not found, skipping tree-sitter extractors"
        return 0
    fi

    # Check if tree-sitter is available
    if ! python3 -c "import tree_sitter" 2>/dev/null; then
        log "tree-sitter Python module not available, skipping"
        return 0
    fi

    local ts_dir="$SCRIPT_DIR/tree-sitter"

    if [[ -f "$ts_dir/extract-accounts.py" ]]; then
        log "Extracting accounts..."
        python3 "$ts_dir/extract-accounts.py" "$TARGET_DIR" > "$ACCOUNTS_FILE" 2>/dev/null || echo '[]' > "$ACCOUNTS_FILE"
    fi

    if [[ -f "$ts_dir/extract-cpis.py" ]]; then
        log "Extracting CPIs..."
        python3 "$ts_dir/extract-cpis.py" "$TARGET_DIR" > "$CPIS_FILE" 2>/dev/null || echo '[]' > "$CPIS_FILE"
    fi

    if [[ -f "$ts_dir/extract-pdas.py" ]]; then
        log "Extracting PDAs..."
        python3 "$ts_dir/extract-pdas.py" "$TARGET_DIR" > "$PDAS_FILE" 2>/dev/null || echo '[]' > "$PDAS_FILE"
    fi

    if [[ -f "$ts_dir/extract-instructions.py" ]]; then
        log "Extracting instructions..."
        python3 "$ts_dir/extract-instructions.py" "$TARGET_DIR" > "$INSTRUCTIONS_FILE" 2>/dev/null || echo '[]' > "$INSTRUCTIONS_FILE"
    fi
}

# ---------------------------------------------------------------------------
# 5. MIR analysis
# ---------------------------------------------------------------------------
run_mir() {
    local mir_dir="$SCRIPT_DIR/mir"

    if [[ ! -x "$mir_dir/emit-mir.sh" ]]; then
        log "emit-mir.sh not found or not executable, skipping MIR"
        return 0
    fi

    if ! command -v cargo &>/dev/null; then
        log "cargo not found, skipping MIR"
        return 0
    fi

    log "Emitting MIR..."
    local mir_output_dir="$OUTPUT_DIR/mir-output"
    mkdir -p "$mir_output_dir"
    "$mir_dir/emit-mir.sh" "$TARGET_DIR" "$mir_output_dir" 2>/dev/null || true

    if [[ -f "$mir_dir/parse-mir.py" ]] && command -v python3 &>/dev/null; then
        log "Parsing MIR..."
        python3 "$mir_dir/parse-mir.py" "$mir_output_dir" > "$MIR_FILE" 2>/dev/null || echo '[]' > "$MIR_FILE"
    fi
}

# ---------------------------------------------------------------------------
# 6. Merge all outputs into leads.json
# ---------------------------------------------------------------------------
merge_results() {
    log "Merging results into leads.json..."

    python3 -c "
import json, sys

def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default

ast_grep = load_json('$AST_GREP_FILE', [])
clippy = load_json('$CLIPPY_FILE', [])
audit = load_json('$AUDIT_FILE', [])
mir = load_json('$MIR_FILE', [])
accounts = load_json('$ACCOUNTS_FILE', [])
cpis = load_json('$CPIS_FILE', [])
pdas = load_json('$PDAS_FILE', [])
instructions = load_json('$INSTRUCTIONS_FILE', [])

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
    'accounts': accounts,
    'cpis': cpis,
    'pdas': pdas,
    'instructions': instructions,
}

json.dump(output, sys.stdout, indent=2)
" > "$LEADS_FILE"

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

    log "Prescan complete"
    echo "$LEADS_FILE"
}

main
