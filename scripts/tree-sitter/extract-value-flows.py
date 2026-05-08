#!/usr/bin/env python3
"""extract-value-flows.py - Track token transfers, lamport movements,
vault deposits/withdrawals from Solana Rust source files using tree-sitter.

Finds transfer, transfer_checked, mint_to, burn, system_program::transfer,
and direct lamport modifications to map value flow through the program.

Usage:
    python3 extract-value-flows.py /path/to/file.rs
    python3 extract-value-flows.py /path/to/directory

Outputs JSON array of value flow operations to stdout.
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


def extract_anchor_token_ops(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Anchor-style token operations (token::transfer, token::mint_to, etc.)."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    anchor_patterns = [
        (r"token::transfer\b", "spl_transfer"),
        (r"token::transfer_checked\b", "spl_transfer_checked"),
        (r"token::mint_to\b", "spl_mint_to"),
        (r"token::burn\b", "spl_burn"),
        (r"token::approve\b", "spl_approve"),
        (r"token_2022::transfer_checked\b", "token22_transfer_checked"),
        (r"token_2022::mint_to\b", "token22_mint_to"),
        (r"token_2022::burn\b", "token22_burn"),
        (r"transfer_checked\s*\(", "transfer_checked_call"),
    ]

    for pattern, op_type in anchor_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            # Get broader context to extract source/dest/amount
            line_start = source_text.rfind("\n", 0, match.start()) + 1
            # Look further to capture multi-line CPI call
            context_end = source_text.find(";", match.end())
            if context_end == -1:
                context_end = min(len(source_text), match.end() + 300)
            else:
                context_end = min(context_end + 1, match.end() + 500)
            context = source_text[line_start:context_end].strip()

            # Try to extract source, destination, and amount from CPI struct
            from_match = re.search(r"from\s*:\s*([^,}]+)", context)
            to_match = re.search(r"to\s*:\s*([^,}]+)", context)
            amount_match = re.search(r"amount\s*[,)}\s]|,\s*(\w[^,;)]*)\s*[,)]", context)

            source_account = from_match.group(1).strip() if from_match else None
            dest_account = to_match.group(1).strip() if to_match else None

            # Check if amount is validated (compared, checked, or uses checked_math)
            func_start = max(0, source_text.rfind("fn ", 0, match.start()))
            func_end_search = source_text.find("\nfn ", match.end())
            if func_end_search == -1:
                func_end_search = len(source_text)
            func_context = source_text[func_start:func_end_search]

            has_amount_validation = bool(re.search(
                r"checked_(?:add|sub|mul|div)|"
                r"require!.*amount|"
                r"assert!.*amount|"
                r"amount\s*[<>=!]+|"
                r"amount.*overflow|"
                r"checked_math",
                func_context,
                re.IGNORECASE,
            ))

            results.append({
                "type": op_type,
                "file": file_path,
                "line": line_num,
                "context": context[:400],
                "source_account": source_account[:100] if source_account else None,
                "dest_account": dest_account[:100] if dest_account else None,
                "has_amount_validation": has_amount_validation,
            })

    return results


def extract_system_transfers(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract system_program::transfer and native SOL transfer patterns."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    system_patterns = [
        (r"system_program::transfer\b", "system_transfer"),
        (r"system_program::Transfer\b", "system_transfer_struct"),
        (r"system_instruction::transfer\b", "system_instruction_transfer"),
        (r"anchor_lang::system_program::Transfer\b", "anchor_system_transfer"),
    ]

    for pattern, op_type in system_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            context_end = source_text.find(";", match.end())
            if context_end == -1:
                context_end = min(len(source_text), match.end() + 300)
            else:
                context_end = min(context_end + 1, match.end() + 500)
            context = source_text[line_start:context_end].strip()

            # Try to extract from/to
            from_match = re.search(r"from\s*:\s*([^,}]+)", context)
            to_match = re.search(r"to\s*:\s*([^,}]+)", context)

            source_account = from_match.group(1).strip() if from_match else None
            dest_account = to_match.group(1).strip() if to_match else None

            results.append({
                "type": op_type,
                "file": file_path,
                "line": line_num,
                "context": context[:400],
                "source_account": source_account[:100] if source_account else None,
                "dest_account": dest_account[:100] if dest_account else None,
            })

    return results


def extract_lamport_modifications(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract direct lamport balance modifications."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    lamport_patterns = [
        (r"\*\*(\w+)\.(?:try_borrow_mut_lamports|lamports\.borrow_mut)\(\)\?\s*([+-]?=)\s*([^;]+)", "lamport_modify"),
        (r"try_borrow_mut_lamports\s*\(\s*\)", "lamport_borrow_mut"),
    ]

    for pattern, op_type in lamport_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # For detailed lamport_modify pattern, extract account and operation
            account_name = match.group(1) if match.lastindex and match.lastindex >= 1 and op_type == "lamport_modify" else None
            operator = match.group(2) if match.lastindex and match.lastindex >= 2 and op_type == "lamport_modify" else None
            amount_expr = match.group(3).strip() if match.lastindex and match.lastindex >= 3 and op_type == "lamport_modify" else None

            result: dict[str, Any] = {
                "type": op_type,
                "file": file_path,
                "line": line_num,
                "context": context[:300],
            }
            if account_name:
                result["account"] = account_name
            if operator:
                result["operator"] = operator
            if amount_expr:
                result["amount_expression"] = amount_expr[:100]

            results.append(result)

    return results


def extract_invoke_transfers(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract transfer operations done via invoke/invoke_signed."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    call_exprs = find_descendants_by_type(root, "call_expression")

    for call_node in call_exprs:
        call_text = get_node_text(call_node, source)
        func_node = call_node.child_by_field_name("function")
        if func_node is None:
            continue

        func_name = get_node_text(func_node, source)

        # Check for invoke/invoke_signed
        is_invoke = any(
            func_name.endswith(p) or func_name == p
            for p in ["invoke", "invoke_signed"]
        )
        if not is_invoke:
            continue

        # Check if the invoked instruction is a transfer
        args_node = call_node.child_by_field_name("arguments")
        if args_node is None:
            continue

        args_text = get_node_text(args_node, source)
        if not re.search(r"transfer|Transfer", args_text):
            continue

        is_signed = "invoke_signed" in func_name

        # Try to extract amount
        amount_match = re.search(r"lamports\s*:\s*([^,}]+)|,\s*(\d+\w*)\s*[,)]", args_text)
        amount_expr = None
        if amount_match:
            amount_expr = (amount_match.group(1) or amount_match.group(2)).strip()

        results.append({
            "type": "invoke_transfer_signed" if is_signed else "invoke_transfer",
            "file": file_path,
            "line": call_node.start_point.row + 1,
            "context": call_text[:400],
            "amount_expression": amount_expr[:100] if amount_expr else None,
        })

    return results


def extract_vault_patterns(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract vault deposit/withdrawal patterns."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    vault_patterns = [
        (r"(?:deposit|stake|add_liquidity|supply)\s*\(", "vault_deposit"),
        (r"(?:withdraw|unstake|remove_liquidity|redeem)\s*\(", "vault_withdrawal"),
    ]

    for pattern, op_type in vault_patterns:
        for match in re.finditer(pattern, source_text, re.IGNORECASE):
            # Skip if inside a comment
            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_text = source_text[line_start:match.start()]
            if "//" in line_text:
                continue

            line_num = source_text[:match.start()].count("\n") + 1

            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # Skip function definitions (we want calls, not declarations)
            if re.match(r"^\s*(?:pub\s+)?(?:fn|async\s+fn)\s+", context):
                continue

            results.append({
                "type": op_type,
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
    results.extend(extract_anchor_token_ops(tree, source, rel_path))
    results.extend(extract_system_transfers(tree, source, rel_path))
    results.extend(extract_lamport_modifications(tree, source, rel_path))
    results.extend(extract_invoke_transfers(tree, source, rel_path))
    results.extend(extract_vault_patterns(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract value flow operations from Solana Rust source files."
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
