#!/usr/bin/env bash
set -euo pipefail

# emit-mir.sh - Emit MIR (Mid-level Intermediate Representation) for Solana programs
# Usage: ./emit-mir.sh <cargo-project-directory> [output-directory]

_EMIT_MIR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_EMIT_MIR_DIR/../_activate-venv.sh"

usage() {
    echo "Usage: $0 <cargo-project-directory> [output-directory]" >&2
    exit 1
}

if [[ $# -lt 1 ]]; then
    usage
fi

TARGET_DIR="$(realpath "$1")"
OUTPUT_DIR="${2:-$TARGET_DIR/mir-output}"

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Error: Directory '$TARGET_DIR' does not exist." >&2
    exit 1
fi

if [[ ! -f "$TARGET_DIR/Cargo.toml" ]]; then
    echo "Error: No Cargo.toml found in '$TARGET_DIR'." >&2
    exit 1
fi

# Check for cargo
if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found in PATH." >&2
    echo "Install Rust: https://rustup.rs/" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

log() {
    echo "[emit-mir] $(date '+%H:%M:%S') $*" >&2
}

# ---------------------------------------------------------------------------
# Detect workspace members or single crate
# ---------------------------------------------------------------------------
get_program_crates() {
    local dir="$1"
    local crates=()

    # Check if this is a workspace
    if grep -q '\[workspace\]' "$dir/Cargo.toml" 2>/dev/null; then
        # Extract workspace members
        local members
        members=$(python3 -c "
import tomllib, sys, os
try:
    with open('$dir/Cargo.toml', 'rb') as f:
        data = tomllib.load(f)
    members = data.get('workspace', {}).get('members', [])
    for m in members:
        # Expand globs
        if '*' in m:
            import glob
            for path in glob.glob(os.path.join('$dir', m)):
                if os.path.isfile(os.path.join(path, 'Cargo.toml')):
                    print(path)
        else:
            path = os.path.join('$dir', m)
            if os.path.isfile(os.path.join(path, 'Cargo.toml')):
                print(path)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
" 2>/dev/null) || true

        if [[ -n "$members" ]]; then
            while IFS= read -r member; do
                crates+=("$member")
            done <<< "$members"
        fi
    fi

    # If no workspace members found, use the root crate
    if [[ ${#crates[@]} -eq 0 ]]; then
        crates=("$dir")
    fi

    printf '%s\n' "${crates[@]}"
}

# ---------------------------------------------------------------------------
# Check if a crate is a Solana program (has solana-program or anchor-lang dep)
# ---------------------------------------------------------------------------
is_solana_program() {
    local crate_dir="$1"
    local cargo_toml="$crate_dir/Cargo.toml"

    if [[ ! -f "$cargo_toml" ]]; then
        return 1
    fi

    if grep -q 'solana-program\|anchor-lang\|pinocchio' "$cargo_toml" 2>/dev/null; then
        return 0
    fi

    return 1
}

# ---------------------------------------------------------------------------
# Emit MIR for a single crate
# ---------------------------------------------------------------------------
emit_mir_for_crate() {
    local crate_dir="$1"
    local crate_name
    crate_name=$(basename "$crate_dir")

    log "Emitting MIR for crate: $crate_name ($crate_dir)"

    local mir_file="$OUTPUT_DIR/${crate_name}.mir"

    # Try to emit MIR
    # Use RUSTFLAGS to emit MIR
    if (cd "$crate_dir" && RUSTFLAGS="--emit=mir" cargo rustc --lib 2>/dev/null); then
        # Find the generated MIR file in the target directory
        local found_mir
        found_mir=$(find "$crate_dir/target" -name "*.mir" -newer "$mir_file" 2>/dev/null | head -1) || true

        if [[ -n "$found_mir" ]]; then
            cp "$found_mir" "$mir_file"
            log "MIR saved to: $mir_file"
        else
            # Try alternative: cargo rustc with --emit flag directly
            if (cd "$crate_dir" && cargo rustc --lib -- --emit=mir 2>/dev/null); then
                found_mir=$(find "$crate_dir/target" -name "*.mir" 2>/dev/null | head -1) || true
                if [[ -n "$found_mir" ]]; then
                    cp "$found_mir" "$mir_file"
                    log "MIR saved to: $mir_file"
                else
                    log "Warning: MIR compilation succeeded but output file not found for $crate_name"
                fi
            else
                log "Warning: Failed to emit MIR for $crate_name"
            fi
        fi
    else
        log "Warning: MIR compilation failed for $crate_name (this is expected without Solana toolchain)"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log "Target directory: $TARGET_DIR"
    log "Output directory: $OUTPUT_DIR"

    local crates
    crates=$(get_program_crates "$TARGET_DIR")

    local found_any=false

    while IFS= read -r crate_dir; do
        [[ -z "$crate_dir" ]] && continue

        if is_solana_program "$crate_dir"; then
            found_any=true
            emit_mir_for_crate "$crate_dir"
        else
            log "Skipping non-Solana crate: $(basename "$crate_dir")"
        fi
    done <<< "$crates"

    if [[ "$found_any" == "false" ]]; then
        log "No Solana program crates found in $TARGET_DIR"
    fi

    # List generated MIR files
    local mir_count
    mir_count=$(find "$OUTPUT_DIR" -name "*.mir" 2>/dev/null | wc -l)
    log "Generated $mir_count MIR file(s) in $OUTPUT_DIR"
}

main
