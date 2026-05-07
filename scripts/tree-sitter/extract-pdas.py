#!/usr/bin/env python3
"""extract-pdas.py - Extract PDA (Program Derived Address) derivations from
Solana Rust source files using tree-sitter.

Finds find_program_address() and create_program_address() calls and extracts
seed components and bump handling.

Usage:
    python3 extract-pdas.py /path/to/file.rs
    python3 extract-pdas.py /path/to/directory

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


def parse_seeds(seeds_text: str) -> list[str]:
    """Parse seed array components from a seeds expression."""
    seeds = []
    # Remove outer &[ and ]
    inner = seeds_text.strip()
    if inner.startswith("&["):
        inner = inner[2:]
    if inner.endswith("]"):
        inner = inner[:-1]

    # Split on commas, respecting nested brackets and parens
    depth = 0
    current = ""
    for ch in inner:
        if ch in ("(", "[", "{"):
            depth += 1
            current += ch
        elif ch in (")", "]", "}"):
            depth -= 1
            current += ch
        elif ch == "," and depth == 0:
            seed = current.strip()
            if seed:
                seeds.append(seed)
            current = ""
        else:
            current += ch

    seed = current.strip()
    if seed:
        seeds.append(seed)

    return seeds


def extract_find_program_address(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Pubkey::find_program_address() calls."""
    results = []
    root = tree.root_node

    call_exprs = find_descendants_by_type(root, "call_expression")

    for call_node in call_exprs:
        call_text = get_node_text(call_node, source)
        func_node = call_node.child_by_field_name("function")
        if func_node is None:
            continue

        func_name = get_node_text(func_node, source)

        is_find = "find_program_address" in func_name
        is_create = "create_program_address" in func_name

        if not is_find and not is_create:
            continue

        pda_info: dict[str, Any] = {
            "type": "find_program_address" if is_find else "create_program_address",
            "file": file_path,
            "line": call_node.start_point.row + 1,
            "raw_call": call_text[:400],
            "seeds": [],
            "program_id": None,
            "bump_handling": None,
        }

        args_node = call_node.child_by_field_name("arguments")
        if args_node:
            args_text = get_node_text(args_node, source)

            # Extract seeds array - first argument
            # Pattern: find_program_address(&[seed1, seed2, ...], program_id)
            seeds_match = re.search(r"&\[([^\]]*(?:\[[^\]]*\])*[^\]]*)\]", args_text)
            if seeds_match:
                seeds_raw = "&[" + seeds_match.group(1) + "]"
                pda_info["seeds"] = parse_seeds(seeds_raw)

            # Extract program_id - second argument
            # Split on the closing ] of seeds and get the rest
            parts = args_text.split("],", 1)
            if len(parts) > 1:
                prog_part = parts[1].strip().rstrip(")")
                pda_info["program_id"] = prog_part.strip()

        # Check for bump handling in surrounding context
        # Look at the parent let binding or surrounding code
        parent = call_node.parent
        while parent and parent.type not in ("let_declaration", "expression_statement", "function_item"):
            parent = parent.parent

        if parent:
            parent_text = get_node_text(parent, source)

            # Check if bump is captured in a tuple destructure
            if re.search(r"let\s*\(\s*\w+\s*,\s*(\w+)\s*\)", parent_text):
                bump_var = re.search(r"let\s*\(\s*\w+\s*,\s*(\w+)\s*\)", parent_text)
                if bump_var:
                    pda_info["bump_handling"] = f"captured as {bump_var.group(1)}"
            elif "_" in parent_text and re.search(r"let\s*\(\s*\w+\s*,\s*_\s*\)", parent_text):
                pda_info["bump_handling"] = "bump discarded (potential issue)"

        results.append(pda_info)

    return results


def extract_anchor_seeds(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract PDA seeds from Anchor #[account(seeds = [...])] constraints."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    # Find seeds = [...] patterns in attributes
    for match in re.finditer(
        r"#\[account\([^]]*seeds\s*=\s*\[([^\]]*)\][^]]*(?:bump\s*(?:=\s*(\w+[.\w]*))?)?\s*[^]]*\)\]",
        source_text,
        re.DOTALL,
    ):
        line_num = source_text[:match.start()].count("\n") + 1
        seeds_text = match.group(1)
        bump = match.group(2) if match.group(2) else "auto"

        seeds = [s.strip() for s in seeds_text.split(",") if s.strip()]

        results.append({
            "type": "anchor_seeds_constraint",
            "file": file_path,
            "line": line_num,
            "seeds": seeds,
            "bump": bump,
            "raw_constraint": match.group(0)[:200],
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
    results.extend(extract_find_program_address(tree, source, rel_path))
    results.extend(extract_anchor_seeds(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract PDA (Program Derived Address) derivations from Solana Rust source files."
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
