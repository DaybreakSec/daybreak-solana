#!/usr/bin/env python3
"""extract-close-patterns.py - Extract account closing patterns, rent reclamation,
and close authority validation from Solana Rust source files using tree-sitter.

Finds close constraints, lamport transfers to zero, data zeroing, and potential
account revival risks.

Usage:
    python3 extract-close-patterns.py /path/to/file.rs
    python3 extract-close-patterns.py /path/to/directory

Outputs JSON array of close patterns to stdout.
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


def extract_anchor_close_constraints(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Anchor #[account(close = target)] constraints."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    # Find all attribute items that contain 'close'
    attr_nodes = find_descendants_by_type(root, "attribute_item")

    for attr_node in attr_nodes:
        attr_text = get_node_text(attr_node, source)

        # Match close = <target> inside account attributes
        close_match = re.search(r"close\s*=\s*(\w+)", attr_text)
        if not close_match:
            continue

        close_target = close_match.group(1)

        # Find the associated field declaration by looking forward from this attribute
        parent = attr_node.parent
        if parent is None:
            continue

        field_name = "unknown"
        field_type = "unknown"
        idx = None
        for i, child in enumerate(parent.children):
            if child.id == attr_node.id:
                idx = i
                break

        if idx is not None:
            for i in range(idx + 1, len(parent.children)):
                sibling = parent.children[i]
                if sibling.type == "field_declaration":
                    name_node = sibling.child_by_field_name("name")
                    type_node = sibling.child_by_field_name("type")
                    if name_node:
                        field_name = get_node_text(name_node, source)
                    if type_node:
                        field_type = get_node_text(type_node, source)
                    break
                elif sibling.type not in ("attribute_item", "line_comment", "block_comment", ","):
                    break

        results.append({
            "type": "anchor_close_constraint",
            "file": file_path,
            "line": attr_node.start_point.row + 1,
            "account_name": field_name,
            "account_type": field_type,
            "close_target": close_target,
            "has_data_zeroing": True,  # Anchor close handles this automatically
            "has_owner_reassign": True,  # Anchor close handles this automatically
        })

    return results


def extract_native_close_patterns(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract native Solana account close patterns (manual lamport drain + data zeroing)."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    functions = find_descendants_by_type(root, "function_item")

    for func_node in functions:
        func_text = get_node_text(func_node, source)
        func_name_node = func_node.child_by_field_name("name")
        func_name = get_node_text(func_name_node, source) if func_name_node else "unknown"

        # Check for lamport drain patterns:
        # dest.lamports() + source.lamports()   (adding lamports to dest)
        # **source.lamports.borrow_mut() = 0    (zeroing source lamports)
        # source.try_borrow_mut_lamports()       (borrowing lamports mutably)
        has_lamport_drain = bool(re.search(
            r"lamports.*borrow_mut.*=\s*0|"
            r"try_borrow_mut_lamports|"
            r"\.lamports\(\).*\+.*\.lamports\(\)",
            func_text,
        ))

        if not has_lamport_drain:
            continue

        # Check if data is zeroed after closing
        has_data_zeroing = bool(re.search(
            r"data.*borrow_mut.*fill\(0\)|"
            r"data_as_mut.*fill\(0\)|"
            r"sol_memset|"
            r"data\.borrow_mut\(\).*=.*\[0|"
            r"\.data\.borrow_mut\(\)\[\.\.8\]\.copy_from_slice|"
            r"\.assign\s*\(\s*&system_program",
            func_text,
        ))

        # Check if owner is reassigned to system program
        has_owner_reassign = bool(re.search(
            r"assign.*system_program|"
            r"owner.*=.*system_program|"
            r"\.assign\s*\(",
            func_text,
        ))

        # Get the line of the first lamport manipulation
        lamport_match = re.search(
            r"lamports.*borrow_mut|try_borrow_mut_lamports",
            func_text,
        )
        if lamport_match:
            # Calculate line number relative to function start
            pre_text = func_text[:lamport_match.start()]
            offset_lines = pre_text.count("\n")
            line_num = func_node.start_point.row + 1 + offset_lines
        else:
            line_num = func_node.start_point.row + 1

        results.append({
            "type": "native_close",
            "file": file_path,
            "line": line_num,
            "function": func_name,
            "has_data_zeroing": has_data_zeroing,
            "has_owner_reassign": has_owner_reassign,
            "revival_risk": not has_data_zeroing or not has_owner_reassign,
        })

    return results


def extract_close_account_cpi(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract token::close_account and CloseAccount CPI calls."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # SPL Token close_account patterns
    close_patterns = [
        (r"token::close_account\b", "anchor_token_close"),
        (r"CloseAccount\s*\{", "close_account_struct"),
        (r"close_account\s*\(", "close_account_call"),
        (r"spl_token.*close_account", "spl_close_account"),
    ]

    for pattern, pattern_type in close_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # For token close accounts, check if authority is validated
            func_start = max(0, source_text.rfind("fn ", 0, match.start()))
            func_end_search = source_text.find("\nfn ", match.end())
            if func_end_search == -1:
                func_end_search = len(source_text)
            func_context = source_text[func_start:func_end_search]

            has_authority_check = bool(re.search(
                r"authority|owner|signer|admin",
                func_context,
                re.IGNORECASE,
            ))

            results.append({
                "type": pattern_type,
                "file": file_path,
                "line": line_num,
                "context": context[:300],
                "has_authority_check": has_authority_check,
            })

    return results


def extract_rent_exempt_checks(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract rent exemption checks near close operations."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # Look for rent-related patterns that might indicate close-related logic
    rent_patterns = [
        (r"rent_epoch\s*=\s*0", "rent_epoch_zero"),
        (r"minimum_balance\s*\(", "rent_minimum_balance_check"),
        (r"is_exempt\s*\(", "rent_exempt_check"),
        (r"Rent::get\(\)", "rent_sysvar_access"),
    ]

    for pattern, pattern_type in rent_patterns:
        for match in re.finditer(pattern, source_text):
            # Only include if there is a close-related pattern nearby
            search_start = max(0, match.start() - 500)
            search_end = min(len(source_text), match.end() + 500)
            nearby = source_text[search_start:search_end]

            if not re.search(r"close|drain|lamports.*=\s*0|zero", nearby, re.IGNORECASE):
                continue

            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            results.append({
                "type": pattern_type,
                "file": file_path,
                "line": line_num,
                "context": context[:300],
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
    results.extend(extract_anchor_close_constraints(tree, source, rel_path))
    results.extend(extract_native_close_patterns(tree, source, rel_path))
    results.extend(extract_close_account_cpi(tree, source, rel_path))
    results.extend(extract_rent_exempt_checks(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract account closing patterns from Solana Rust source files."
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
