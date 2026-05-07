#!/usr/bin/env python3
"""sanitize.py - Scan repository files for prompt injection patterns,
command injection risks, and suspicious content.

Usage:
    python3 sanitize.py /path/to/repo

Outputs JSON to stdout with warnings and overall risk level.
Uses only Python standard library (no pip dependencies).
"""

import argparse
import base64
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Prompt injection patterns
# ---------------------------------------------------------------------------
PROMPT_INJECTION_PATTERNS: list[tuple[str, str, str]] = [
    (r"ignore\s+(?:all\s+)?previous\s+instructions", "high", "prompt_injection_ignore_previous"),
    (r"ignore\s+all\s+prior", "high", "prompt_injection_ignore_prior"),
    (r"you\s+are\s+now", "high", "prompt_injection_role_override"),
    (r"system\s+prompt", "medium", "prompt_injection_system_prompt_ref"),
    (r"forget\s+everything", "high", "prompt_injection_forget"),
    (r"disregard\s+(?:all\s+)?(?:previous|prior|above)", "high", "prompt_injection_disregard"),
    (r"new\s+instructions?\s*:", "medium", "prompt_injection_new_instructions"),
    (r"act\s+as\s+(?:if|though)\s+you", "medium", "prompt_injection_act_as"),
    (r"override\s+(?:your\s+)?(?:system|safety|instructions)", "high", "prompt_injection_override"),
    (r"jailbreak", "high", "prompt_injection_jailbreak"),
]

# ---------------------------------------------------------------------------
# Command injection patterns (for build.rs, shell scripts, Cargo.toml)
# ---------------------------------------------------------------------------
COMMAND_INJECTION_PATTERNS: list[tuple[str, str, str]] = [
    (r"std::process::Command::new\s*\(", "medium", "command_execution"),
    (r"process::Command::new\s*\(", "medium", "command_execution"),
    (r"exec\s*\(", "medium", "exec_call"),
    (r"system\s*\(", "medium", "system_call"),
    (r"\beval\b\s*[\(\"]", "high", "eval_call"),
    (r"curl\s+.*\|\s*(?:sh|bash)", "high", "curl_pipe_shell"),
    (r"wget\s+.*\|\s*(?:sh|bash)", "high", "wget_pipe_shell"),
    (r"\$\(curl", "high", "command_substitution_curl"),
    (r"base64\s+--?d", "medium", "base64_decode_in_script"),
    (r"\\x[0-9a-fA-F]{2}", "medium", "hex_escape_sequence"),
    (r"(?:nc|ncat|netcat)\s+", "medium", "netcat_usage"),
    (r"reverse\s*shell", "high", "reverse_shell_ref"),
    (r"/dev/tcp/", "high", "dev_tcp_connection"),
]

# ---------------------------------------------------------------------------
# Suspicious Unicode ranges (homoglyphs, zero-width characters, etc.)
# ---------------------------------------------------------------------------
SUSPICIOUS_UNICODE: list[tuple[int, int, str]] = [
    (0x200B, 0x200F, "zero_width_character"),       # Zero-width space, joiner, etc.
    (0x2028, 0x2029, "unicode_line_separator"),      # Line/paragraph separator
    (0x202A, 0x202E, "bidi_override"),               # Bidi overrides
    (0x2066, 0x2069, "bidi_isolate"),                # Bidi isolates
    (0xFEFF, 0xFEFF, "byte_order_mark"),             # BOM in middle of file
    (0xFFF0, 0xFFFF, "special_unicode"),             # Specials block
    (0x00AD, 0x00AD, "soft_hyphen"),                 # Soft hyphen (invisible)
]

# Homoglyph check: characters that look like ASCII but aren't
HOMOGLYPH_MAP: dict[str, str] = {
    "\u0410": "A", "\u0412": "B", "\u0421": "C", "\u0415": "E",
    "\u041D": "H", "\u041A": "K", "\u041C": "M", "\u041E": "O",
    "\u0420": "P", "\u0422": "T", "\u0425": "X",
    "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p",
    "\u0441": "c", "\u0443": "y", "\u0445": "x",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H",
    "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N",
    "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A7": "X",
    "\u03B1": "a", "\u03B5": "e", "\u03BF": "o", "\u03C1": "p",
}

# File extensions to scan
SCANNABLE_EXTENSIONS: set[str] = {
    ".rs", ".toml", ".ts", ".js", ".py", ".sh", ".bash",
    ".yml", ".yaml", ".json", ".md", ".txt", ".cfg", ".ini",
}

# Build-related files that need command injection scanning
BUILD_FILE_PATTERNS: list[str] = [
    "build.rs",
    "Cargo.toml",
    "Makefile",
    "makefile",
]

SHELL_EXTENSIONS: set[str] = {".sh", ".bash"}


def is_scannable(path: Path) -> bool:
    """Check if a file should be scanned."""
    if path.suffix.lower() in SCANNABLE_EXTENSIONS:
        return True
    if path.name in BUILD_FILE_PATTERNS:
        return True
    return False


def is_build_file(path: Path) -> bool:
    """Check if a file is a build-related file."""
    if path.name in BUILD_FILE_PATTERNS:
        return True
    if path.suffix.lower() in SHELL_EXTENSIONS:
        return True
    return False


def is_binary_file(path: Path) -> bool:
    """Quick check for binary files."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(8192)
            return b"\x00" in chunk
    except (OSError, PermissionError):
        return True


def check_base64_in_comments(line: str, line_num: int, file_path: str) -> list[dict[str, Any]]:
    """Check for base64-encoded suspicious strings in comments."""
    warnings: list[dict[str, Any]] = []

    # Find comment portions of the line
    comment_match = re.search(r"(?://|#|/\*)\s*(.*)", line)
    if not comment_match:
        return warnings

    comment_text = comment_match.group(1).rstrip("*/").strip()

    # Look for base64-like strings (at least 20 chars, valid base64 alphabet)
    b64_pattern = re.compile(r"[A-Za-z0-9+/=]{20,}")
    for match in b64_pattern.finditer(comment_text):
        candidate = match.group(0)
        try:
            decoded = base64.b64decode(candidate, validate=True).decode("utf-8", errors="ignore")
            # Check if decoded content contains suspicious patterns
            decoded_lower = decoded.lower()
            for pattern, severity, name in PROMPT_INJECTION_PATTERNS:
                if re.search(pattern, decoded_lower):
                    warnings.append({
                        "file": file_path,
                        "line": line_num,
                        "risk": "high",
                        "pattern": f"base64_encoded_{name}",
                        "context": f"Base64 in comment decodes to suspicious content: {decoded[:80]}...",
                    })
                    break
            else:
                # Even if no injection pattern, flag long base64 in comments
                if len(candidate) > 40:
                    warnings.append({
                        "file": file_path,
                        "line": line_num,
                        "risk": "low",
                        "pattern": "base64_in_comment",
                        "context": f"Base64 string in comment ({len(candidate)} chars): {candidate[:40]}...",
                    })
        except Exception:
            continue

    return warnings


def check_unicode(line: str, line_num: int, file_path: str) -> list[dict[str, Any]]:
    """Check for suspicious Unicode characters."""
    warnings: list[dict[str, Any]] = []

    for i, ch in enumerate(line):
        code_point = ord(ch)

        # Check suspicious Unicode ranges
        for range_start, range_end, name in SUSPICIOUS_UNICODE:
            if range_start <= code_point <= range_end:
                # Skip BOM at start of file
                if code_point == 0xFEFF and line_num == 1 and i == 0:
                    continue
                warnings.append({
                    "file": file_path,
                    "line": line_num,
                    "risk": "high",
                    "pattern": f"suspicious_unicode_{name}",
                    "context": f"Character U+{code_point:04X} ({unicodedata.name(ch, 'UNKNOWN')}) at column {i+1}",
                })
                break

        # Check homoglyphs
        if ch in HOMOGLYPH_MAP:
            warnings.append({
                "file": file_path,
                "line": line_num,
                "risk": "high",
                "pattern": "homoglyph",
                "context": (
                    f"Character U+{code_point:04X} ({unicodedata.name(ch, 'UNKNOWN')}) "
                    f"looks like ASCII '{HOMOGLYPH_MAP[ch]}' at column {i+1}"
                ),
            })

    return warnings


def scan_file(file_path: Path, root_dir: Path) -> list[dict[str, Any]]:
    """Scan a single file for all patterns."""
    warnings: list[dict[str, Any]] = []
    rel_path = str(file_path.relative_to(root_dir))

    if is_binary_file(file_path):
        return warnings

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except (OSError, PermissionError) as e:
        warnings.append({
            "file": rel_path,
            "line": 0,
            "risk": "low",
            "pattern": "file_read_error",
            "context": str(e),
        })
        return warnings

    is_build = is_build_file(file_path)
    in_cargo_build_section = False

    for line_num, line in enumerate(lines, start=1):
        line_lower = line.lower()

        # --- Prompt injection patterns ---
        for pattern, severity, name in PROMPT_INJECTION_PATTERNS:
            if re.search(pattern, line_lower):
                warnings.append({
                    "file": rel_path,
                    "line": line_num,
                    "risk": severity,
                    "pattern": name,
                    "context": line.strip()[:200],
                })

        # --- Base64 in comments ---
        warnings.extend(check_base64_in_comments(line, line_num, rel_path))

        # --- Suspicious Unicode ---
        warnings.extend(check_unicode(line, line_num, rel_path))

        # --- Extremely long single-line comments (>500 chars) ---
        comment_match = re.search(r"(?://|#)\s*(.*)", line)
        if comment_match:
            comment_body = comment_match.group(1)
            if len(comment_body) > 500:
                warnings.append({
                    "file": rel_path,
                    "line": line_num,
                    "risk": "medium",
                    "pattern": "long_comment",
                    "context": f"Comment is {len(comment_body)} chars: {comment_body[:100]}...",
                })

        # --- Command injection in build files ---
        if is_build:
            # Track [build] section in Cargo.toml
            if file_path.name == "Cargo.toml":
                if re.match(r"\s*\[build", line_lower):
                    in_cargo_build_section = True
                elif re.match(r"\s*\[", line):
                    in_cargo_build_section = False

            should_check_commands = (
                file_path.name == "build.rs"
                or file_path.suffix.lower() in SHELL_EXTENSIONS
                or in_cargo_build_section
            )

            if should_check_commands:
                for pattern, severity, name in COMMAND_INJECTION_PATTERNS:
                    if re.search(pattern, line):
                        warnings.append({
                            "file": rel_path,
                            "line": line_num,
                            "risk": severity,
                            "pattern": f"build_{name}",
                            "context": line.strip()[:200],
                        })

    return warnings


def compute_risk_level(warnings: list[dict[str, Any]]) -> str:
    """Compute overall risk level from warnings."""
    if not warnings:
        return "low"

    high_count = sum(1 for w in warnings if w["risk"] == "high")
    medium_count = sum(1 for w in warnings if w["risk"] == "medium")

    if high_count > 0:
        return "high"
    if medium_count > 2:
        return "medium"
    return "low"


def scan_directory(target_dir: Path) -> dict[str, Any]:
    """Scan all files in a directory."""
    all_warnings: list[dict[str, Any]] = []

    # Skip these directories
    skip_dirs = {"target", "node_modules", ".git", "vendor", "__pycache__"}

    for root, dirs, files in os.walk(target_dir):
        # Prune skipped directories
        dirs[:] = [d for d in dirs if d not in skip_dirs]

        for filename in files:
            file_path = Path(root) / filename
            if is_scannable(file_path):
                file_warnings = scan_file(file_path, target_dir)
                all_warnings.extend(file_warnings)

    risk_level = compute_risk_level(all_warnings)

    return {
        "warnings": all_warnings,
        "risk_level": risk_level,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan repository for prompt injection patterns and suspicious content."
    )
    parser.add_argument(
        "directory",
        help="Path to the directory to scan",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output",
    )

    args = parser.parse_args()
    target_dir = Path(args.directory).resolve()

    if not target_dir.is_dir():
        print(f"Error: '{target_dir}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    result = scan_directory(target_dir)

    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, indent=indent)
    print()  # trailing newline


if __name__ == "__main__":
    main()
