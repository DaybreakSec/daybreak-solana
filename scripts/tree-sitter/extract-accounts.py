#!/usr/bin/env python3
"""extract-accounts.py - Extract Solana account structs and their constraints
from Rust source files using tree-sitter.

Handles both Anchor (#[derive(Accounts)]) and native account validation patterns.

Usage:
    python3 extract-accounts.py /path/to/file.rs
    python3 extract-accounts.py /path/to/directory

Outputs JSON array of account structs to stdout.
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


def find_children_by_type(node: tree_sitter.Node, type_name: str) -> list[tree_sitter.Node]:
    """Find all direct children of a specific type."""
    return [child for child in node.children if child.type == type_name]


def find_descendants_by_type(node: tree_sitter.Node, type_name: str) -> list[tree_sitter.Node]:
    """Recursively find all descendants of a specific type."""
    results = []
    if node.type == type_name:
        results.append(node)
    for child in node.children:
        results.extend(find_descendants_by_type(child, type_name))
    return results


def extract_constraints(attr_text: str) -> dict[str, Any]:
    """Parse Anchor account constraint attributes."""
    constraints: dict[str, Any] = {
        "mutable": False,
        "signer": False,
        "init": False,
        "init_if_needed": False,
        "close": None,
        "has_one": [],
        "seeds": [],
        "bump": None,
        "payer": None,
        "space": None,
        "constraint": [],
        "address": None,
        "token": {},
        "associated_token": {},
    }

    # Check for mut
    if re.search(r"\bmut\b", attr_text):
        constraints["mutable"] = True

    # Check for signer
    if re.search(r"\bsigner\b", attr_text):
        constraints["signer"] = True

    # Check for init
    if re.search(r"\binit_if_needed\b", attr_text):
        constraints["init_if_needed"] = True
        constraints["init"] = True
    elif re.search(r"\binit\b", attr_text):
        constraints["init"] = True

    # Extract close target
    close_match = re.search(r"close\s*=\s*(\w+)", attr_text)
    if close_match:
        constraints["close"] = close_match.group(1)

    # Extract has_one
    for m in re.finditer(r"has_one\s*=\s*(\w+)", attr_text):
        constraints["has_one"].append(m.group(1))

    # Extract seeds
    seeds_match = re.search(r"seeds\s*=\s*\[([^\]]*)\]", attr_text)
    if seeds_match:
        seeds_text = seeds_match.group(1)
        # Parse individual seed components
        for seed in re.findall(r"[^,]+", seeds_text):
            seed = seed.strip()
            if seed:
                constraints["seeds"].append(seed)

    # Extract bump
    bump_match = re.search(r"bump\s*(?:=\s*(\w+[.\w]*))?", attr_text)
    if bump_match:
        constraints["bump"] = bump_match.group(1) if bump_match.group(1) else "auto"

    # Extract payer
    payer_match = re.search(r"payer\s*=\s*(\w+)", attr_text)
    if payer_match:
        constraints["payer"] = payer_match.group(1)

    # Extract space
    space_match = re.search(r"space\s*=\s*([^,\]]+)", attr_text)
    if space_match:
        constraints["space"] = space_match.group(1).strip()

    # Extract address constraint
    address_match = re.search(r"address\s*=\s*([^,\]]+)", attr_text)
    if address_match:
        constraints["address"] = address_match.group(1).strip()

    # Extract generic constraints
    for m in re.finditer(r"constraint\s*=\s*([^,\]]+)", attr_text):
        constraints["constraint"].append(m.group(1).strip())

    # Clean up empty lists and None values for compact output
    return {k: v for k, v in constraints.items() if v and v != []}


def extract_anchor_accounts(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Anchor #[derive(Accounts)] structs."""
    results = []
    root = tree.root_node

    # Find all struct items
    structs = find_descendants_by_type(root, "struct_item")

    for struct_node in structs:
        # Check if struct has #[derive(Accounts)] attribute
        # Look at preceding siblings for attribute items
        has_accounts_derive = False
        parent = struct_node.parent
        if parent is None:
            continue

        # Check attributes before the struct
        idx = None
        for i, child in enumerate(parent.children):
            if child.id == struct_node.id:
                idx = i
                break

        if idx is not None:
            for i in range(idx - 1, -1, -1):
                sibling = parent.children[i]
                if sibling.type == "attribute_item":
                    attr_text = get_node_text(sibling, source)
                    if "Accounts" in attr_text:
                        has_accounts_derive = True
                        break
                elif sibling.type not in ("attribute_item", "line_comment", "block_comment"):
                    break

        if not has_accounts_derive:
            continue

        # Extract struct name
        name_node = struct_node.child_by_field_name("name")
        struct_name = get_node_text(name_node, source) if name_node else "unknown"

        # Extract fields
        fields = []
        field_decl_list = None
        for child in struct_node.children:
            if child.type == "field_declaration_list":
                field_decl_list = child
                break

        if field_decl_list is None:
            continue

        field_decls = find_children_by_type(field_decl_list, "field_declaration")

        for field_node in field_decls:
            field_name_node = field_node.child_by_field_name("name")
            field_type_node = field_node.child_by_field_name("type")

            field_name = get_node_text(field_name_node, source) if field_name_node else "unknown"
            field_type = get_node_text(field_type_node, source) if field_type_node else "unknown"

            # Look for #[account(...)] attributes on this field
            constraints = {}
            field_idx = None
            for i, child in enumerate(field_decl_list.children):
                if child.id == field_node.id:
                    field_idx = i
                    break

            if field_idx is not None:
                for i in range(field_idx - 1, -1, -1):
                    sibling = field_decl_list.children[i]
                    if sibling.type == "attribute_item":
                        attr_text = get_node_text(sibling, source)
                        if "account" in attr_text.lower():
                            constraints = extract_constraints(attr_text)
                    elif sibling.type not in ("attribute_item", "line_comment", "block_comment", ","):
                        break

            fields.append({
                "name": field_name,
                "type": field_type,
                "constraints": constraints,
            })

        results.append({
            "struct_name": struct_name,
            "framework": "anchor",
            "file": file_path,
            "line": struct_node.start_point.row + 1,
            "fields": fields,
        })

    return results


def extract_native_accounts(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract native Solana account validation patterns (next_account_info, etc.)."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    # Find functions that use next_account_info or account iteration
    functions = find_descendants_by_type(root, "function_item")

    for func_node in functions:
        func_text = get_node_text(func_node, source)

        # Check if this function processes accounts
        if "next_account_info" not in func_text and "account_info" not in func_text.lower():
            continue

        func_name_node = func_node.child_by_field_name("name")
        func_name = get_node_text(func_name_node, source) if func_name_node else "unknown"

        # Extract account assignments via next_account_info
        fields = []
        for match in re.finditer(
            r"let\s+(\w+)\s*=\s*next_account_info\s*\(\s*(\w+)\s*\)",
            func_text,
        ):
            account_name = match.group(1)

            # Try to detect validation checks for this account
            constraints = {}

            # Check for is_signer validation
            if re.search(rf"{account_name}\.is_signer", func_text):
                constraints["signer"] = True

            # Check for is_writable validation
            if re.search(rf"{account_name}\.is_writable", func_text):
                constraints["mutable"] = True

            # Check for owner validation
            owner_match = re.search(
                rf"{account_name}\.owner\s*==\s*([^\s;]+)", func_text
            )
            if owner_match:
                constraints["owner"] = owner_match.group(1)

            # Check for key comparison (has_one equivalent)
            key_matches = re.findall(
                rf"{account_name}\.key\s*==\s*([^\s;]+)", func_text
            )
            if key_matches:
                constraints["key_checks"] = key_matches

            fields.append({
                "name": account_name,
                "type": "AccountInfo",
                "constraints": constraints,
            })

        if fields:
            results.append({
                "struct_name": f"{func_name}_accounts",
                "framework": "native",
                "file": file_path,
                "line": func_node.start_point.row + 1,
                "fields": fields,
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
    results.extend(extract_anchor_accounts(tree, source, rel_path))
    results.extend(extract_native_accounts(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract Solana account structs and constraints from Rust source files."
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
