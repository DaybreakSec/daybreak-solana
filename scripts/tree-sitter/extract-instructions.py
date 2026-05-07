#!/usr/bin/env python3
"""extract-instructions.py - Extract Solana instruction handler functions from
Rust source files using tree-sitter.

Handles both Anchor (#[program] mod) and native (process_instruction match arms)
patterns.

Usage:
    python3 extract-instructions.py /path/to/file.rs
    python3 extract-instructions.py /path/to/directory

Outputs JSON array to stdout.
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


def find_children_by_type(node: tree_sitter.Node, type_name: str) -> list[tree_sitter.Node]:
    """Find all direct children of a specific type."""
    return [child for child in node.children if child.type == type_name]


def extract_function_params(func_node: tree_sitter.Node, source: bytes) -> list[dict[str, str]]:
    """Extract parameters from a function definition."""
    params = []
    params_node = func_node.child_by_field_name("parameters")
    if params_node is None:
        return params

    for child in params_node.children:
        if child.type == "parameter":
            pattern_node = child.child_by_field_name("pattern")
            type_node = child.child_by_field_name("type")
            param_name = get_node_text(pattern_node, source) if pattern_node else "unknown"
            param_type = get_node_text(type_node, source) if type_node else "unknown"
            params.append({"name": param_name, "type": param_type})
        elif child.type == "self_parameter":
            params.append({"name": "self", "type": get_node_text(child, source)})

    return params


def extract_return_type(func_node: tree_sitter.Node, source: bytes) -> str:
    """Extract the return type of a function."""
    ret_type = func_node.child_by_field_name("return_type")
    if ret_type:
        return get_node_text(ret_type, source)
    return "()"


def extract_anchor_instructions(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract instruction handlers from Anchor #[program] modules."""
    results = []
    root = tree.root_node

    # Find mod items
    mod_items = find_descendants_by_type(root, "mod_item")

    for mod_node in mod_items:
        # Check if this mod has a #[program] attribute
        has_program_attr = False
        parent = mod_node.parent
        if parent is None:
            continue

        idx = None
        for i, child in enumerate(parent.children):
            if child.id == mod_node.id:
                idx = i
                break

        if idx is not None:
            for i in range(idx - 1, -1, -1):
                sibling = parent.children[i]
                if sibling.type == "attribute_item":
                    attr_text = get_node_text(sibling, source)
                    if "program" in attr_text:
                        has_program_attr = True
                        break
                elif sibling.type not in ("attribute_item", "line_comment", "block_comment"):
                    break

        if not has_program_attr:
            continue

        # Extract module name
        mod_name_node = mod_node.child_by_field_name("name")
        mod_name = get_node_text(mod_name_node, source) if mod_name_node else "unknown"

        # Find the declaration list (body of the mod)
        decl_list = None
        for child in mod_node.children:
            if child.type == "declaration_list":
                decl_list = child
                break

        if decl_list is None:
            continue

        # Find all pub fn items inside the module
        functions = find_descendants_by_type(decl_list, "function_item")

        for func_node in functions:
            # Check if function is pub
            func_text = get_node_text(func_node, source)
            if not func_text.strip().startswith("pub"):
                continue

            func_name_node = func_node.child_by_field_name("name")
            func_name = get_node_text(func_name_node, source) if func_name_node else "unknown"

            params = extract_function_params(func_node, source)
            return_type = extract_return_type(func_node, source)

            # Extract the Context type parameter to get the accounts struct name
            accounts_struct = None
            for param in params:
                ctx_match = re.search(r"Context\s*<\s*'?\s*_?\s*,?\s*(\w+)\s*>", param["type"])
                if ctx_match:
                    accounts_struct = ctx_match.group(1)
                    break
                # Also handle Context<'_, '_, '_, 'info, AccountStruct<'info>>
                ctx_match2 = re.search(r"Context\s*<[^>]*?(\w+)\s*<", param["type"])
                if ctx_match2:
                    accounts_struct = ctx_match2.group(1)
                    break

            results.append({
                "name": func_name,
                "framework": "anchor",
                "module": mod_name,
                "file": file_path,
                "line": func_node.start_point.row + 1,
                "parameters": params,
                "return_type": return_type,
                "accounts_struct": accounts_struct,
            })

    return results


def extract_native_instructions(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract instruction handlers from native Solana programs.

    Looks for:
    - process_instruction function
    - match arms that dispatch to instruction handlers
    - Individual processor functions
    """
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    functions = find_descendants_by_type(root, "function_item")

    for func_node in functions:
        func_name_node = func_node.child_by_field_name("name")
        if func_name_node is None:
            continue

        func_name = get_node_text(func_name_node, source)

        # Check for process_instruction entry point
        if func_name == "process_instruction":
            params = extract_function_params(func_node, source)
            return_type = extract_return_type(func_node, source)

            entry = {
                "name": func_name,
                "framework": "native",
                "module": None,
                "file": file_path,
                "line": func_node.start_point.row + 1,
                "parameters": params,
                "return_type": return_type,
                "is_entrypoint": True,
                "dispatched_instructions": [],
            }

            # Look for match arms inside this function to find dispatched instructions
            match_exprs = find_descendants_by_type(func_node, "match_expression")
            for match_node in match_exprs:
                match_arms = find_descendants_by_type(match_node, "match_arm")
                for arm in match_arms:
                    arm_text = get_node_text(arm, source)
                    # Extract the instruction variant name from the match pattern
                    pattern_node = arm.child_by_field_name("pattern")
                    if pattern_node:
                        pattern_text = get_node_text(pattern_node, source).strip()
                        entry["dispatched_instructions"].append(pattern_text)

            results.append(entry)

        # Check for processor functions (process_* pattern)
        elif func_name.startswith("process_"):
            func_text = get_node_text(func_node, source)
            if not func_text.strip().startswith("pub") and not func_text.strip().startswith("fn"):
                continue

            params = extract_function_params(func_node, source)
            return_type = extract_return_type(func_node, source)

            results.append({
                "name": func_name,
                "framework": "native",
                "module": None,
                "file": file_path,
                "line": func_node.start_point.row + 1,
                "parameters": params,
                "return_type": return_type,
                "is_entrypoint": False,
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
    results.extend(extract_anchor_instructions(tree, source, rel_path))
    results.extend(extract_native_instructions(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract Solana instruction handler functions from Rust source files."
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
