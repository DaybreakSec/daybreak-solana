#!/usr/bin/env python3
"""extract-auth-patterns.py - Extract authority/admin/owner field definitions
and their usage in instruction account contexts from Solana Rust source files.

Maps authority fields on state accounts to their constraint validation in
#[derive(Accounts)] structs. Identifies where has_one constraints are missing.

Usage:
    python3 extract-auth-patterns.py /path/to/file.rs
    python3 extract-auth-patterns.py /path/to/directory

Outputs JSON array of authority patterns to stdout.
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


# Field names that indicate authority/admin patterns
AUTHORITY_FIELD_PATTERN = re.compile(r"(?i)^(authority|admin|owner|operator|manager|creator|updater)$")


def extract_authority_fields(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Pubkey fields named authority/admin/owner from struct definitions."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    struct_items = find_descendants_by_type(root, "struct_item")

    for struct_node in struct_items:
        name_node = struct_node.child_by_field_name("name")
        struct_name = get_node_text(name_node, source) if name_node else "unknown"

        # Find the field declaration list
        field_list = None
        for child in struct_node.children:
            if child.type == "field_declaration_list":
                field_list = child
                break

        if field_list is None:
            continue

        for child in field_list.children:
            if child.type == "field_declaration":
                field_name_node = child.child_by_field_name("name")
                field_type_node = child.child_by_field_name("type")

                if not field_name_node or not field_type_node:
                    continue

                field_name = get_node_text(field_name_node, source)
                field_type = get_node_text(field_type_node, source)

                if not AUTHORITY_FIELD_PATTERN.match(field_name):
                    continue

                # Check if the field type is Pubkey
                if "Pubkey" not in field_type:
                    continue

                results.append({
                    "type": "authority_field",
                    "struct_name": struct_name,
                    "field_name": field_name,
                    "field_type": field_type,
                    "file": file_path,
                    "line": field_name_node.start_point.row + 1,
                })

    return results


def extract_authority_usage(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract authority account usage in #[derive(Accounts)] structs.

    Looks for Account<'info, T> fields and checks for has_one constraints
    and Signer<'info> accounts that validate authority fields.
    """
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # Find all structs that have #[derive(Accounts)]
    struct_items = find_descendants_by_type(tree.root_node, "struct_item")

    for struct_node in struct_items:
        # Check if this struct has a derive(Accounts) attribute
        struct_text = get_node_text(struct_node, source)
        if "Accounts" not in struct_text:
            continue

        # Check for derive attribute specifically
        has_derive_accounts = False
        for child in struct_node.children:
            if child.type == "attribute_item":
                attr_text = get_node_text(child, source)
                if "derive" in attr_text and "Accounts" in attr_text:
                    has_derive_accounts = True
                    break

        if not has_derive_accounts:
            continue

        struct_name_node = struct_node.child_by_field_name("name")
        struct_name = get_node_text(struct_name_node, source) if struct_name_node else "unknown"

        # Get field declarations
        field_list = None
        for child in struct_node.children:
            if child.type == "field_declaration_list":
                field_list = child
                break

        if field_list is None:
            continue

        # Collect all has_one constraints from the struct
        has_one_constraints = set()
        for match in re.finditer(r"has_one\s*=\s*(\w+)", struct_text):
            has_one_constraints.add(match.group(1))

        # Collect signer accounts
        signer_accounts = set()
        for match in re.finditer(r"pub\s+(\w+)\s*:\s*Signer", struct_text):
            signer_accounts.add(match.group(1))

        # Find Account<'info, T> fields (state accounts)
        for field_child in field_list.children:
            if field_child.type != "field_declaration":
                continue

            field_name_node = field_child.child_by_field_name("name")
            field_type_node = field_child.child_by_field_name("type")

            if not field_name_node or not field_type_node:
                continue

            field_name = get_node_text(field_name_node, source)
            field_type = get_node_text(field_type_node, source)

            # Match Account<'info, SomeType> patterns
            account_match = re.match(r"Account\s*<\s*'[^,]+,\s*(\w+)\s*>", field_type)
            if not account_match:
                continue

            account_type = account_match.group(1)

            # Get constraints for this specific field by looking at preceding attributes
            field_text_region = source_text[
                max(0, field_child.start_byte - 500):field_child.end_byte
            ]

            # Find has_one constraints on this specific account field
            field_has_one = set()
            # Look for #[account(...has_one = X...)] immediately preceding this field
            attr_region = source_text[
                max(0, field_child.start_byte - 300):field_child.start_byte
            ]
            for match in re.finditer(r"has_one\s*=\s*(\w+)", attr_region):
                field_has_one.add(match.group(1))

            # Check for common authority field names in the constraint
            for auth_name in ["authority", "admin", "owner", "operator", "manager"]:
                has_one_for_auth = auth_name in field_has_one or auth_name in has_one_constraints
                signer_for_auth = auth_name in signer_accounts

                # Only report if this account type might have this authority field
                # (We can't know for sure without cross-file analysis, so report all)
                results.append({
                    "type": "authority_usage",
                    "instruction_struct": struct_name,
                    "state_account": field_name,
                    "state_account_type": account_type,
                    "authority_field": auth_name,
                    "has_one_constraint": has_one_for_auth,
                    "signer_validated": signer_for_auth,
                    "file": file_path,
                    "line": field_name_node.start_point.row + 1,
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
    results.extend(extract_authority_fields(tree, source, rel_path))
    results.extend(extract_authority_usage(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract authority/admin patterns from Solana Rust source files."
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
