#!/usr/bin/env python3
"""extract-oracles.py - Extract oracle price feed reads, staleness checks,
and Pyth/Switchboard patterns from Solana Rust source files using tree-sitter.

Finds oracle account usage, staleness check presence, and confidence interval
checks across both Pyth and Switchboard integrations.

Usage:
    python3 extract-oracles.py /path/to/file.rs
    python3 extract-oracles.py /path/to/directory

Outputs JSON array of oracle usage sites to stdout.
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


def extract_pyth_usage(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Pyth oracle usage patterns."""
    results = []
    root = tree.root_node
    source_text = source.decode("utf-8", errors="replace")

    # Pyth-related patterns to look for
    pyth_patterns = [
        (r"load_price_feed_from_account_info", "load_price_feed"),
        (r"get_price_unchecked", "get_price_unchecked"),
        (r"get_price_no_older_than", "get_price_with_staleness"),
        (r"get_current_price", "get_current_price"),
        (r"get_ema_price", "get_ema_price"),
        (r"get_ema_price_unchecked", "get_ema_price_unchecked"),
        (r"get_ema_price_no_older_than", "get_ema_price_with_staleness"),
        (r"Price\s*\{", "price_struct_construction"),
        (r"PriceFeed", "price_feed_type"),
        (r"pyth_sdk", "pyth_sdk_import"),
        (r"pyth_solana_receiver_sdk", "pyth_solana_receiver"),
        (r"PriceUpdateV2", "pyth_price_update_v2"),
        (r"get_price_no_older_than_with_custom_verification_level", "pyth_custom_verification"),
    ]

    for pattern, pattern_type in pyth_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            # Get surrounding context (the full line)
            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # Check for staleness validation in the surrounding function
            # Expand search window: 30 lines before and after
            func_start = max(0, source_text.rfind("fn ", 0, match.start()))
            func_end_search = source_text.find("\nfn ", match.end())
            if func_end_search == -1:
                func_end_search = len(source_text)
            func_context = source_text[func_start:func_end_search]

            has_staleness_check = bool(
                re.search(r"no_older_than|staleness|stale|publish_time|slot.*diff|age", func_context, re.IGNORECASE)
            )
            has_confidence_check = bool(
                re.search(r"conf(?:idence)?(?:\s*[<>=!]|\s*\.|\s*>)", func_context, re.IGNORECASE)
            )
            has_status_check = bool(
                re.search(r"status\s*==|PriceStatus|trading", func_context, re.IGNORECASE)
            )

            results.append({
                "type": "pyth",
                "pattern": pattern_type,
                "file": file_path,
                "line": line_num,
                "context": context[:300],
                "has_staleness_check": has_staleness_check,
                "has_confidence_check": has_confidence_check,
                "has_status_check": has_status_check,
            })

    return results


def extract_switchboard_usage(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract Switchboard oracle usage patterns."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    switchboard_patterns = [
        (r"AggregatorAccountData", "aggregator_account"),
        (r"SwitchboardDecimal", "switchboard_decimal"),
        (r"get_result\b", "get_result"),
        (r"check_staleness\b", "check_staleness"),
        (r"check_confidence_interval\b", "check_confidence_interval"),
        (r"latest_confirmed_round", "latest_confirmed_round"),
        (r"switchboard_v2", "switchboard_v2_import"),
        (r"switchboard_on_demand", "switchboard_on_demand"),
        (r"OracleQueueAccountData", "oracle_queue"),
        (r"pull_feed", "pull_feed"),
    ]

    for pattern, pattern_type in switchboard_patterns:
        for match in re.finditer(pattern, source_text):
            line_num = source_text[:match.start()].count("\n") + 1

            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            # Check surrounding function context for validation
            func_start = max(0, source_text.rfind("fn ", 0, match.start()))
            func_end_search = source_text.find("\nfn ", match.end())
            if func_end_search == -1:
                func_end_search = len(source_text)
            func_context = source_text[func_start:func_end_search]

            has_staleness_check = bool(
                re.search(r"check_staleness|staleness|stale|round_open_timestamp|slot.*diff", func_context, re.IGNORECASE)
            )
            has_confidence_check = bool(
                re.search(r"check_confidence|std_deviation|confidence", func_context, re.IGNORECASE)
            )

            results.append({
                "type": "switchboard",
                "pattern": pattern_type,
                "file": file_path,
                "line": line_num,
                "context": context[:300],
                "has_staleness_check": has_staleness_check,
                "has_confidence_check": has_confidence_check,
            })

    return results


def extract_generic_oracle_patterns(tree: tree_sitter.Tree, source: bytes, file_path: str) -> list[dict[str, Any]]:
    """Extract generic oracle-related patterns that are not Pyth or Switchboard specific."""
    results = []
    source_text = source.decode("utf-8", errors="replace")

    generic_patterns = [
        (r"oracle_price|price_oracle|oracle_account", "oracle_reference"),
        (r"price_feed", "price_feed_reference"),
        (r"get_price\b", "get_price_call"),
        (r"update_price\b", "update_price_call"),
        (r"chainlink", "chainlink_reference"),
    ]

    for pattern, pattern_type in generic_patterns:
        for match in re.finditer(pattern, source_text, re.IGNORECASE):
            # Skip if this is inside a comment
            line_start = source_text.rfind("\n", 0, match.start()) + 1
            line_text = source_text[line_start:match.start()]
            if "//" in line_text:
                continue

            line_num = source_text[:match.start()].count("\n") + 1

            line_end = source_text.find("\n", match.end())
            if line_end == -1:
                line_end = len(source_text)
            context = source_text[line_start:line_end].strip()

            results.append({
                "type": "generic_oracle",
                "pattern": pattern_type,
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
    results.extend(extract_pyth_usage(tree, source, rel_path))
    results.extend(extract_switchboard_usage(tree, source, rel_path))
    results.extend(extract_generic_oracle_patterns(tree, source, rel_path))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract oracle price feed patterns from Solana Rust source files."
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
