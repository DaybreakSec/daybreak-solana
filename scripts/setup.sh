#!/usr/bin/env bash
set -euo pipefail

# setup.sh -Check dependencies, install what we can, warn about the rest.
# Usage: ./scripts/setup.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
warn=0
fail=0

ok()   { echo -e "  ${GREEN}✓${NC} $1"; pass=$((pass + 1)); }
skip() { echo -e "  ${YELLOW}⚠${NC} $1"; warn=$((warn + 1)); }
bad()  { echo -e "  ${RED}✗${NC} $1"; fail=$((fail + 1)); }

echo ""
echo "Daybreak Solana -setup check"
echo "=============================="
echo ""

# ---------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------
echo "Node.js & npm"
if command -v node &>/dev/null; then
    node_ver=$(node --version)
    ok "node $node_ver"
else
    bad "node not found -install Node.js 18+"
fi

if command -v npm &>/dev/null; then
    ok "npm $(npm --version)"
else
    bad "npm not found"
fi

# ---------------------------------------------------------------
# 2. npm install
# ---------------------------------------------------------------
echo ""
echo "Node dependencies"
echo "  Installing npm dependencies..."
if (cd "$ROOT_DIR" && npm install --no-audit --no-fund 2>&1 | tail -1); then
    ok "npm install complete"
else
    bad "npm install failed"
fi

# ---------------------------------------------------------------
# 3. Python 3
# ---------------------------------------------------------------
echo ""
echo "Python"
if command -v python3 &>/dev/null; then
    py_ver=$(python3 --version 2>&1)
    ok "$py_ver"
else
    bad "python3 not found -needed for prescan extractors"
fi

# ---------------------------------------------------------------
# 4. Python tree-sitter modules
# ---------------------------------------------------------------
echo ""
echo "Python packages (tree-sitter)"
if python3 -c "import tree_sitter" 2>/dev/null; then
    ok "tree-sitter module"
else
    skip "tree-sitter not installed -installing..."
    if pip3 install -q -r "$ROOT_DIR/requirements.txt" 2>/dev/null; then
        ok "tree-sitter installed via pip"
    else
        bad "pip install failed -run: pip3 install -r requirements.txt"
    fi
fi

if python3 -c "import tree_sitter_rust" 2>/dev/null; then
    ok "tree-sitter-rust module"
else
    if pip3 install -q tree-sitter-rust 2>/dev/null; then
        ok "tree-sitter-rust installed via pip"
    else
        skip "tree-sitter-rust not installed -run: pip3 install tree-sitter-rust"
    fi
fi

# ---------------------------------------------------------------
# 5. Claude CLI
# ---------------------------------------------------------------
echo ""
echo "Claude CLI"
if command -v claude &>/dev/null; then
    ok "claude found in PATH"
else
    bad "claude not found -install: npm install -g @anthropic-ai/claude-code"
fi

# ---------------------------------------------------------------
# 6. Claude CLI auth
# ---------------------------------------------------------------
echo ""
echo "Claude auth"
if command -v claude &>/dev/null; then
    if claude --version &>/dev/null; then
        ok "claude CLI is accessible"
    else
        skip "claude CLI found but could not verify -run 'claude' to authenticate"
    fi
else
    skip "skipped (claude not installed)"
fi

# ---------------------------------------------------------------
# 7. Optional tools
# ---------------------------------------------------------------
echo ""
echo "Optional tools (prescan)"
if command -v ast-grep &>/dev/null || command -v sg &>/dev/null; then
    ok "ast-grep"
else
    skip "ast-grep not found -pattern-based static analysis will be skipped"
fi

if command -v cargo &>/dev/null; then
    ok "cargo ($(cargo --version 2>/dev/null | head -c 20))"
else
    skip "cargo not found -clippy and cargo-audit will be skipped"
fi

if command -v cargo-audit &>/dev/null; then
    ok "cargo-audit"
else
    skip "cargo-audit not found -dependency vulnerability scan will be skipped"
fi

# ---------------------------------------------------------------
# 8. Reference files (knowledge injection)
# ---------------------------------------------------------------
echo ""
echo "Reference files"
refs_ok=true
for f in bug-class-ids.json audit-report-analysis.md dismissed-patterns-solana.md; do
    if [[ -f "$ROOT_DIR/references/$f" ]]; then
        ok "references/$f"
    else
        bad "references/$f missing -knowledge injection will be degraded"
        refs_ok=false
    fi
done

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo ""
echo "=============================="
total=$((pass + warn + fail))
echo -e "  ${GREEN}$pass passed${NC}  ${YELLOW}$warn warnings${NC}  ${RED}$fail failed${NC}  ($total checks)"

if [[ $fail -gt 0 ]]; then
    echo ""
    echo "Fix the failed checks above before running scans."
    exit 1
elif [[ $warn -gt 0 ]]; then
    echo ""
    echo "Ready to run. Optional tools above will be skipped."
    exit 0
else
    echo ""
    echo "All good. Run: npm run dev"
    exit 0
fi
