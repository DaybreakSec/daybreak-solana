#!/usr/bin/env python3
"""extract-state-machines.py - Extract state enum transitions, phase gates,
and lifecycle patterns from Solana Rust source files using tree-sitter.

Finds enum definitions with state-like variants, state field assignments,
match arms on state fields, and state transition guards.

Usage:
    python3 extract-state-machines.py /path/to/file.rs
    python3 extract-state-machines.py /path/to/directory

Outputs JSON array of state machine patterns to stdout.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import tree_sitter
    import tree_sitter_rust
except ImportError as e:
    print(
        f"Error: Required module not found: {e}\n"
        "Install with: pip install tree-sitter tree-sitter-rust",
        file=sys.stderr,
    )
    sys.exit(1)


def get_parser() -> tree_sitter.Parser:
    """Create and return a tree-sitter Rust parser."""
    rust_language = tree_sitter.Language(tree_sitter_rust.language())
    parser = tree_sitter.Parser(rust_language)
    return parser


def get_node_text(node: tree_sitter.Node, source: bytes) -> str:
    """Extract text content of a tree-sitter node."""
    return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def find_descendants_by_type(node: tree_sitter.Node, type_name: str) -> list[tree_sitter.Node]:
    """Recursively find all descendants of a specific type."""
    results = []
    if node.type == type_name:
        results.append(node)
    for child in node.children:
        results.extend(find_descendants_by_type(child, type_name))
    return results


# Variant names that indicate state machine patterns
STATE_VARIANT_KEYWORDS = {
    "active", "inactive", "paused", "closed", "open", "pending",
    "initialized", "uninitialized", "frozen", "cancelled", "canceled",
    "completed", "expired", "settled", "processing", "finalized",
    "created", "started", "stopped", "locked", "unlocked",
    "depositing", "withdrawing", "liquidating", "liquidated",
    "idle", "running", "halted", "suspended", "disabled", "enabled",
}


def extract_state_enums(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract enum definitions that look like state machines."""
    results = []
    root = tree.root_node

    enum_items = find_descendants_by_type(root, "enum_item")

    for enum_node in enum_items:
        name_node = enum_node.child_by_field_name("name")
        enum_name = get_node_text(name_node, source) if name_node else "unknown"

        # Find the enum variant list
        variant_list = None
        for child in enum_node.children:
            if child.type == "enum_variant_list":
                variant_list = child
                break

        if variant_list is None:
            continue

        # Extract variants
        variants = []
        for child in variant_list.children:
            if child.type == "enum_variant":
                variant_name_node = child.child_by_field_name("name")
                if variant_name_node:
                    variants.append(get_node_text(variant_name_node, source))

        # Check if this looks like a state enum
        # Either the enum name contains "state"/"status"/"phase", or
        # multiple variants match state-like keywords
        name_is_state = bool(re.search(r"(?i)state|status|phase|stage|mode|lifecycle", enum_name))
        state_variant_count = sum(1 for v in variants if v.lower() in STATE_VARIANT_KEYWORDS)

        if not name_is_state and state_variant_count < 2:
            continue

        results.append({
            "type": "state_enum",
            "enum_name": enum_name,
            "variants": variants,
            "state_variant_count": state_variant_count,
            "file": file_path,
            "line": enum_node.start_point.row + 1,
        })

    return results


def extract_state_transitions(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract state field assignments that represent state transitions."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # Look for assignments to state/status fields
    # Patterns: x.state = State::Active, self.status = Status::Closed, etc.
    transition_patterns = [
        r"(\w+)\.(?:state|status|phase|stage)\s*=\s*(\w+(?:::\w+)?)",
        r"(?:state|status|phase|stage)\s*:\s*(\w+(?:::\w+)?)\s*(?:\.into\(\))?",
    ]

    for pattern in transition_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # Check if there is a guard/require before this transition
            # Look backwards up to 10 lines for require!/assert!/if checks
            guard_search_start = source_text.rfind("\n", 0, max(0, match.start() - 500))
            if guard_search_start == -1:
                guard_search_start = 0
            pre_context = source_text[guard_search_start:match.start()]

            has_guard = bool(
                re.search(r"require!|assert!|ensure!|if\s+.*state|if\s+.*status|match\s+.*state|match\s+.*status", pre_context)
            )

            new_state = match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(1)

            results.append({
                "type": "state_transition",
                "file": file_path,
                "line": line_num,
                "context": context[:300],
                "new_state": new_state,
                "has_guard": has_guard,
            })

    return results


def extract_state_matches(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract match expressions on state/status fields."""
    results = []
    root = tree.root_node

    match_exprs = find_descendants_by_type(root, "match_expression")

    for match_node in match_exprs:
        match_text = get_node_text(match_node, source)

        # Check if the match is on a state-like field
        value_node = match_node.child_by_field_name("value")
        if value_node is None:
            continue

        value_text = get_node_text(value_node, source)
        if not re.search(r"(?i)state|status|phase|stage|mode", value_text):
            continue

        # Extract match arms
        arms = []
        match_body = match_node.child_by_field_name("body")
        if match_body:
            arm_nodes = find_descendants_by_type(match_body, "match_arm")
            for arm_node in arm_nodes:
                pattern_node = arm_node.child_by_field_name("pattern")
                if pattern_node:
                    arm_pattern = get_node_text(pattern_node, source)
                    arms.append(arm_pattern)

        results.append({
            "type": "state_match",
            "file": file_path,
            "line": match_node.start_point.row + 1,
            "match_target": value_text[:100],
            "arms": arms,
            "arm_count": len(arms),
        })

    return results


def extract_state_guards(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract require!/assert! checks that gate on state values."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # Look for require!/assert! with state checks
    guard_patterns = [
        r"(require!\s*\([^;]*(?:state|status|phase|stage)[^;]*\))",
        r"(assert!\s*\([^;]*(?:state|status|phase|stage)[^;]*\))",
        r"(ensure!\s*\([^;]*(?:state|status|phase|stage)[^;]*\))",
    ]

    for pattern in guard_patterns:
        for match in re.finditer(pattern, source_text, re.IGNORECASE):
            line_num = source_text[:match.start()].count("\n") + 1
            context = match.group(1).strip()

            # Try to extract the expected state value
            expected_match = re.search(r"==\s*(\w+(?:::\w+)?)", context)
            expected_state = expected_match.group(1) if expected_match else None

            # Try to extract the error
            error_match = re.search(r",\s*(\w+(?:::\w+)?)\s*\)$", context)
            error_code = error_match.group(1) if error_match else None

            results.append({
                "type": "state_guard",
                "file": file_path,
                "line": line_num,
                "context": context[:300],
                "expected_state": expected_state,
                "error_code": error_code,
            })

    return results


def process_file(parser: tree_sitter.Parser, file_path: Path, root_dir: Path) -> list[dict[str, Any]]:
    """Process a single Rust file."""
    try:
        source = file_path.read_bytes()
    except (OSError, PermissionError) as e:
        print(f"Warning: Could not read {file_path}: {e}", file=sys.stderr)
        return []

    tree = parser.parse(source)
    rel_path = str(file_path.relative_to(root_dir))

    results = []
    results.extend(extract_state_enums(tree, source, rel_path))
    results.extend(extract_state_transitions(tree, source, rel_path))
    results.extend(extract_state_matches(tree, source, rel_path))
    results.extend(extract_state_guards(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract state machine patterns from Solana Rust source files."
    )
    parser.add_argument(
        "path",
        help="Rust source file or directory to analyze",
    )

    args = parser.parse_args()
    target = Path(args.path).resolve()

    ts_parser = get_parser()
    all_results: list[dict[str, Any]] = []

    if target.is_file():
        all_results.extend(process_file(ts_parser, target, target.parent))
    elif target.is_dir():
        skip_dirs = {"target", "node_modules", ".git", "vendor"}
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for filename in files:
                if filename.endswith(".rs"):
                    file_path = Path(root) / filename
                    all_results.extend(process_file(ts_parser, file_path, target))
    else:
        print(f"Error: '{target}' is not a file or directory.", file=sys.stderr)
        sys.exit(1)

    json.dump(all_results, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
