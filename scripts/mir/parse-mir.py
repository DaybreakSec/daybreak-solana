#!/usr/bin/env python3
"""parse-mir.py - Parse Rust MIR (Mid-level Intermediate Representation) files
for security-relevant patterns in Solana programs.

Analyzes MIR for:
- Panic/abort paths
- Unsafe blocks
- Unbounded loops
- Function call graph

Usage:
    python3 parse-mir.py /path/to/file.mir
    python3 parse-mir.py /path/to/mir-directory

Outputs JSON with findings to stdout.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


def parse_mir_file(file_path: Path) -> dict[str, Any]:
    """Parse a single MIR file and extract security-relevant patterns."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, PermissionError) as e:
        return {"file": str(file_path), "error": str(e), "findings": []}

    findings: list[dict[str, Any]] = []
    functions: list[dict[str, Any]] = []
    call_graph: dict[str, list[str]] = {}

    lines = content.split("\n")
    current_fn: str | None = None
    current_fn_line = 0
    in_unsafe = False
    brace_depth = 0

    # Patterns
    fn_pattern = re.compile(r"^fn\s+(\S+)\s*\(")
    fn_def_pattern = re.compile(r"^(fn|pub fn)\s+([^\s(]+)")
    call_pattern = re.compile(r"=\s*(\S+)\(")
    panic_patterns = [
        re.compile(r"\bpanic\b"),
        re.compile(r"\bpanic_fmt\b"),
        re.compile(r"\bpanic_bounds_check\b"),
        re.compile(r"\bbegin_panic\b"),
        re.compile(r"\bunwrap_failed\b"),
        re.compile(r"\bexpect_failed\b"),
        re.compile(r"\babort\b"),
        re.compile(r"\bcore::panicking"),
        re.compile(r"\bstd::process::abort"),
    ]
    unsafe_pattern = re.compile(r"\bunsafe\b")
    loop_patterns = [
        re.compile(r"\bgoto\s*->\s*bb\d+"),  # backward goto (potential loop)
        re.compile(r"\bswitchInt.*->\s*\[.*bb\d+"),
    ]
    assert_pattern = re.compile(r"\bassert\b.*->\s*\[.*bb\d+.*bb\d+\]")

    for line_num, line in enumerate(lines, start=1):
        stripped = line.strip()

        # Track function boundaries
        fn_match = fn_def_pattern.match(stripped) or fn_pattern.match(stripped)
        if fn_match:
            current_fn = fn_match.group(2) if fn_match.lastindex and fn_match.lastindex >= 2 else fn_match.group(1)
            current_fn_line = line_num
            brace_depth = 0
            call_graph.setdefault(current_fn, [])

            functions.append({
                "name": current_fn,
                "line": line_num,
            })

        # Track brace depth for scope
        brace_depth += stripped.count("{") - stripped.count("}")

        # --- Panic/abort detection ---
        for panic_pat in panic_patterns:
            if panic_pat.search(stripped):
                findings.append({
                    "type": "panic_path",
                    "severity": "warning",
                    "message": f"Panic/abort path detected in {current_fn or 'unknown'}",
                    "file": str(file_path.name),
                    "line": line_num,
                    "function": current_fn,
                    "snippet": stripped[:200],
                })
                break

        # --- Unsafe detection ---
        if unsafe_pattern.search(stripped):
            findings.append({
                "type": "unsafe_block",
                "severity": "warning",
                "message": f"Unsafe block in {current_fn or 'unknown'}",
                "file": str(file_path.name),
                "line": line_num,
                "function": current_fn,
                "snippet": stripped[:200],
            })

        # --- Loop detection (backward jumps in MIR) ---
        for loop_pat in loop_patterns:
            if loop_pat.search(stripped):
                # Check if this is a backward jump (potential unbounded loop)
                goto_match = re.search(r"bb(\d+)", stripped)
                if goto_match:
                    target_bb = int(goto_match.group(1))
                    # In MIR, backward jumps to earlier basic blocks suggest loops
                    findings.append({
                        "type": "potential_loop",
                        "severity": "info",
                        "message": f"Potential loop detected in {current_fn or 'unknown'} (jump to bb{target_bb})",
                        "file": str(file_path.name),
                        "line": line_num,
                        "function": current_fn,
                        "snippet": stripped[:200],
                    })
                break

        # --- Assert/bounds check detection ---
        if assert_pattern.search(stripped):
            findings.append({
                "type": "assert_check",
                "severity": "info",
                "message": f"Assert/bounds check in {current_fn or 'unknown'}",
                "file": str(file_path.name),
                "line": line_num,
                "function": current_fn,
                "snippet": stripped[:200],
            })

        # --- Build call graph ---
        if current_fn:
            call_match = call_pattern.search(stripped)
            if call_match:
                callee = call_match.group(1)
                # Clean up the callee name
                callee = callee.strip("&*")
                if callee and not callee.startswith("_") and callee not in ("move", "const"):
                    call_graph.setdefault(current_fn, []).append(callee)

    # Deduplicate call graph entries
    for fn_name in call_graph:
        call_graph[fn_name] = sorted(set(call_graph[fn_name]))

    # Post-processing: detect unbounded loops by analyzing the call graph
    # Functions that call themselves (direct recursion) without obvious bounds
    for fn_name, callees in call_graph.items():
        if fn_name in callees:
            findings.append({
                "type": "recursive_call",
                "severity": "warning",
                "message": f"Direct recursion detected in {fn_name}",
                "file": str(file_path.name),
                "line": 0,
                "function": fn_name,
                "snippet": "",
            })

    return {
        "file": str(file_path.name),
        "findings": findings,
        "functions": functions,
        "call_graph": call_graph,
        "stats": {
            "total_functions": len(functions),
            "panic_paths": len([f for f in findings if f["type"] == "panic_path"]),
            "unsafe_blocks": len([f for f in findings if f["type"] == "unsafe_block"]),
            "potential_loops": len([f for f in findings if f["type"] == "potential_loop"]),
            "recursive_calls": len([f for f in findings if f["type"] == "recursive_call"]),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse Rust MIR files for security-relevant patterns in Solana programs."
    )
    parser.add_argument(
        "path",
        help="MIR file or directory containing MIR files to analyze",
    )
    parser.add_argument(
        "--flat",
        action="store_true",
        help="Output a flat list of findings instead of per-file structure",
    )

    args = parser.parse_args()
    target = Path(args.path).resolve()

    results: list[dict[str, Any]] = []

    if target.is_file():
        result = parse_mir_file(target)
        results.append(result)
    elif target.is_dir():
        mir_files = sorted(target.glob("*.mir"))
        if not mir_files:
            print("Warning: No .mir files found in directory.", file=sys.stderr)

        for mir_file in mir_files:
            result = parse_mir_file(mir_file)
            results.append(result)
    else:
        print(f"Error: '{target}' is not a file or directory.", file=sys.stderr)
        sys.exit(1)

    if args.flat:
        # Flatten all findings into a single list
        all_findings = []
        for result in results:
            for finding in result.get("findings", []):
                finding["source_file"] = result["file"]
                all_findings.append(finding)
        json.dump(all_findings, sys.stdout, indent=2)
    else:
        json.dump(results, sys.stdout, indent=2)

    print()


if __name__ == "__main__":
    main()
