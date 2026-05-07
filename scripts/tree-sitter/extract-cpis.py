#!/usr/bin/env python3
"""extract-cpis.py - Extract Cross-Program Invocation (CPI) calls from
Solana Rust source files using tree-sitter.

Finds invoke(), invoke_signed(), and CpiContext::new() calls and extracts
target program, accounts passed, and signer seeds.

Usage:
    python3 extract-cpis.py /path/to/file.rs
    python3 extract-cpis.py /path/to/directory

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


def extract_invoke_calls(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract invoke() and invoke_signed() calls."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    # Find all call expressions
    call_exprs = find_descendants_by_type(root, "call_expression")

    for call_node in call_exprs:
        call_text = get_node_text(call_node, source)
        func_node = call_node.child_by_field_name("function")
        if func_node is None:
            continue

        func_name = get_node_text(func_node, source)

        # Check for invoke / invoke_signed patterns
        is_invoke = False
        is_signed = False

        invoke_patterns = [
            "invoke", "invoke_signed",
            "solana_program::program::invoke",
            "solana_program::program::invoke_signed",
            "program::invoke", "program::invoke_signed",
            "anchor_lang::solana_program::program::invoke",
            "anchor_lang::solana_program::program::invoke_signed",
        ]

        for pattern in invoke_patterns:
            if func_name.endswith(pattern) or func_name == pattern:
                is_invoke = True
                is_signed = "signed" in pattern
                break

        if not is_invoke:
            continue

        # Extract arguments
        args_node = call_node.child_by_field_name("arguments")
        cpi_info: dict[str, Any] = {
            "type": "invoke_signed" if is_signed else "invoke",
            "file": file_path,
            "line": call_node.start_point.row + 1,
            "raw_call": call_text[:300],
            "target_program": None,
            "accounts": [],
            "signer_seeds": None,
        }

        if args_node:
            args_text = get_node_text(args_node, source)

            # Try to extract program ID from the instruction argument
            # Common pattern: &Instruction { program_id: xxx, ... }
            prog_match = re.search(r"program_id\s*:\s*([^,}]+)", args_text)
            if prog_match:
                cpi_info["target_program"] = prog_match.group(1).strip()

            # Try to extract from known helper functions
            for known_prog in [
                "system_program", "spl_token", "token_program",
                "associated_token", "rent", "clock",
            ]:
                if known_prog in args_text.lower():
                    cpi_info["target_program"] = known_prog
                    break

            # Extract signer seeds for invoke_signed
            if is_signed:
                seeds_match = re.search(r"&\[&\[([^\]]*(?:\[[^\]]*\])*[^\]]*)\]\]", args_text)
                if seeds_match:
                    cpi_info["signer_seeds"] = seeds_match.group(0)[:200]

        results.append(cpi_info)

    return results


def extract_cpi_context_calls(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract CpiContext::new() and CpiContext::new_with_signer() calls."""
    results = []
    root = tree.root_node

    call_exprs = find_descendants_by_type(root, "call_expression")

    for call_node in call_exprs:
        call_text = get_node_text(call_node, source)
        func_node = call_node.child_by_field_name("function")
        if func_node is None:
            continue

        func_name = get_node_text(func_node, source)

        if "CpiContext::new" not in func_name:
            continue

        is_signed = "new_with_signer" in func_name

        cpi_info: dict[str, Any] = {
            "type": "cpi_context_with_signer" if is_signed else "cpi_context",
            "file": file_path,
            "line": call_node.start_point.row + 1,
            "raw_call": call_text[:300],
            "target_program": None,
            "accounts_struct": None,
            "signer_seeds": None,
        }

        args_node = call_node.child_by_field_name("arguments")
        if args_node:
            args_text = get_node_text(args_node, source)

            # First argument is typically the program account
            # CpiContext::new(program.to_account_info(), TransferAccounts { ... })
            prog_match = re.search(r"\(\s*([^,]+)", args_text)
            if prog_match:
                cpi_info["target_program"] = prog_match.group(1).strip()[:100]

            # Second argument is the accounts struct
            struct_match = re.search(r",\s*(\w+\s*\{[^}]*\})", args_text, re.DOTALL)
            if struct_match:
                cpi_info["accounts_struct"] = struct_match.group(1).strip()[:200]

            if is_signed:
                cpi_info["signer_seeds"] = "present"

        results.append(cpi_info)

    return results


def extract_anchor_cpi_calls(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Anchor-style CPI calls like token::transfer, system_program::transfer, etc."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    # Look for common Anchor CPI patterns
    cpi_patterns = [
        (r"token::transfer\b", "spl_token"),
        (r"token::transfer_checked\b", "spl_token"),
        (r"token::mint_to\b", "spl_token"),
        (r"token::burn\b", "spl_token"),
        (r"token::close_account\b", "spl_token"),
        (r"token::approve\b", "spl_token"),
        (r"token::revoke\b", "spl_token"),
        (r"token::freeze_account\b", "spl_token"),
        (r"token::thaw_account\b", "spl_token"),
        (r"system_program::transfer\b", "system_program"),
        (r"system_program::create_account\b", "system_program"),
        (r"associated_token::create\b", "associated_token"),
    ]

    for pattern, target_prog in cpi_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1
            # Get the full statement context
            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            results.append({
                "type": "anchor_cpi",
                "file": file_path,
                "line": line_num,
                "raw_call": context[:300],
                "target_program": target_prog,
                "function": match.group(0),
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
    results.extend(extract_invoke_calls(tree, source, rel_path))
    results.extend(extract_cpi_context_calls(tree, source, rel_path))
    results.extend(extract_anchor_cpi_calls(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract CPI (Cross-Program Invocation) calls from Solana Rust source files."
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
