#!/usr/bin/env bash
set -euo pipefail

# scope.sh - Analyze Solana project scope: LOC counting, framework detection, file manifest
# Usage: ./scope.sh /path/to/repo

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

# ---------------------------------------------------------------------------
# Helper: strip Rust comments from a file and count non-blank lines
# Handles single-line (//) and block (/* ... */) comments
# ---------------------------------------------------------------------------
strip_comments_loc() {
    local file="$1"
    # Use perl for reliable multi-line comment stripping
    perl -0777 -pe '
        # Remove block comments (non-greedy, handles nested poorly but good enough)
        s{/\*.*?\*/}{}gs;
        # Remove single-line comments
        s{//[^\n]*}{}g;
    ' "$file" | grep -cv '^\s*$' 2>/dev/null || echo 0
}

# ---------------------------------------------------------------------------
# Detect framework
# ---------------------------------------------------------------------------
detect_framework() {
    local dir="$1"
    local framework="unknown"

    # Check for Anchor
    if [[ -f "$dir/Anchor.toml" ]]; then
        framework="anchor"
    elif find "$dir" -name "Cargo.toml" -print0 2>/dev/null | xargs -0 grep -ql 'anchor-lang' 2>/dev/null; then
        framework="anchor"
    # Check for Pinocchio
    elif find "$dir" -name "Cargo.toml" -print0 2>/dev/null | xargs -0 grep -ql 'pinocchio' 2>/dev/null; then
        framework="pinocchio"
    # Check for Native Solana
    elif find "$dir" -name "Cargo.toml" -print0 2>/dev/null | xargs -0 grep -ql 'solana-program' 2>/dev/null; then
        framework="native"
    fi

    echo "$framework"
}

# ---------------------------------------------------------------------------
# Run LOC counting tool (scc > cloc > wc -l)
# ---------------------------------------------------------------------------
run_loc_tool() {
    local dir="$1"

    if command -v scc &>/dev/null; then
        scc "$dir" \
            --exclude-dir tests,vendor,target,node_modules \
            --format json 2>/dev/null || true
    elif command -v cloc &>/dev/null; then
        cloc "$dir" \
            --exclude-dir=tests,vendor,target,node_modules \
            --json 2>/dev/null || true
    else
        # Fallback: wc -l on Rust files
        local total=0
        while IFS= read -r -d '' f; do
            local lines
            lines=$(wc -l < "$f")
            total=$((total + lines))
        done < <(find "$dir" \
            -path '*/tests/*' -prune -o \
            -path '*/vendor/*' -prune -o \
            -path '*/target/*' -prune -o \
            -path '*/node_modules/*' -prune -o \
            -name '*.rs' -print0 2>/dev/null)
        echo "{\"fallback_total_loc\": $total}"
    fi
}

# ---------------------------------------------------------------------------
# Build file manifest with per-file LOC (comments stripped)
# ---------------------------------------------------------------------------
build_manifest() {
    local dir="$1"
    local files_json="["
    local first=true
    local total_loc=0
    local test_loc=0

    while IFS= read -r -d '' file; do
        local rel_path="${file#"$dir"/}"
        local loc
        loc=$(strip_comments_loc "$file")
        local lang="rust"

        # Detect language by extension
        case "$file" in
            *.rs) lang="rust" ;;
            *.ts) lang="typescript" ;;
            *.js) lang="javascript" ;;
            *.toml) lang="toml" ;;
            *.json) lang="json" ;;
            *.py) lang="python" ;;
            *) lang="other" ;;
        esac

        if [[ "$first" == "true" ]]; then
            first=false
        else
            files_json+=","
        fi

        files_json+="{\"path\":\"$rel_path\",\"loc\":$loc,\"language\":\"$lang\"}"

        # Accumulate totals
        if [[ "$rel_path" == tests/* ]] || [[ "$rel_path" == */tests/* ]] || [[ "$rel_path" == *_test.rs ]] || [[ "$rel_path" == *test_*.rs ]]; then
            test_loc=$((test_loc + loc))
        else
            total_loc=$((total_loc + loc))
        fi
    done < <(find "$dir" \
        -path '*/vendor/*' -prune -o \
        -path '*/target/*' -prune -o \
        -path '*/node_modules/*' -prune -o \
        \( -name '*.rs' -o -name '*.ts' -o -name '*.js' -o -name '*.toml' -o -name '*.py' \) -print0 2>/dev/null)

    files_json+="]"

    echo "$files_json" "$total_loc" "$test_loc"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    local framework
    framework=$(detect_framework "$TARGET_DIR")

    # Run the LOC tool in the background (informational, written to stderr)
    run_loc_tool "$TARGET_DIR" >/dev/null 2>&1 || true

    # Build file manifest
    local manifest_output
    manifest_output=$(build_manifest "$TARGET_DIR")

    # Parse the manifest output: last two tokens are total_loc and test_loc
    local files_json total_loc test_loc
    test_loc=$(echo "$manifest_output" | awk '{print $NF}')
    total_loc=$(echo "$manifest_output" | awk '{print $(NF-1)}')
    # Everything before the last two tokens is the files JSON
    files_json=$(echo "$manifest_output" | rev | cut -d' ' -f3- | rev)

    # Handle edge case where files_json might be empty
    if [[ -z "$files_json" ]]; then
        files_json="[]"
        total_loc=0
        test_loc=0
    fi

    # Output final JSON
    cat <<ENDJSON
{
  "framework": "$framework",
  "files": $files_json,
  "total_loc": $total_loc,
  "test_loc": $test_loc
}
ENDJSON
}

main
