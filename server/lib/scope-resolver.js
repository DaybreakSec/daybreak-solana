const fs = require('fs');
const path = require('path');

/**
 * Parse scope notes into actionable directives for filtering the audit.
 *
 * Recognized patterns (case-insensitive):
 *   branch:<ref>        — checkout a specific branch
 *   pr:<num> / pr #<num> — fetch and checkout a pull request head
 *   commit:<hash>       — checkout a specific commit (7+ hex chars)
 *   tag:<name>          — checkout a specific tag
 *   dir:<path>          — narrow scope to a subdirectory
 *   folder:<path>       — alias for dir:
 *   include:<glob>      — only include files matching glob
 *   exclude:<glob>      — exclude files matching glob
 *
 * Fuzzy: "week4 only", "only week4" → scans repo for directories matching *week4*
 *
 * @param {string} scopeNotes — raw scope notes text
 * @returns {{ branch?: string, pr?: number, commit?: string, tag?: string,
 *             subdir?: string, includePatterns?: string[], excludePatterns?: string[] }}
 */
function parseScopeDirectives(scopeNotes) {
  if (!scopeNotes || typeof scopeNotes !== 'string') return {};

  const directives = {};
  const includePatterns = [];
  const excludePatterns = [];

  // Normalize line endings and split
  const lines = scopeNotes.replace(/\r\n/g, '\n').split('\n');
  const full = scopeNotes.trim();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // branch:<ref> or branch: <ref>
    const branchMatch = line.match(/^branch:\s*(.+)$/i);
    if (branchMatch) {
      directives.branch = branchMatch[1].trim();
      continue;
    }

    // pr:<num> or pr #<num> or pr: <num>
    const prMatch = line.match(/^pr[:#\s]+(\d+)$/i);
    if (prMatch) {
      directives.pr = parseInt(prMatch[1], 10);
      continue;
    }

    // commit:<hash> (7+ hex chars)
    const commitMatch = line.match(/^commit:\s*([0-9a-f]{7,40})$/i);
    if (commitMatch) {
      directives.commit = commitMatch[1].toLowerCase();
      continue;
    }

    // tag:<name>
    const tagMatch = line.match(/^tag:\s*(.+)$/i);
    if (tagMatch) {
      directives.tag = tagMatch[1].trim();
      continue;
    }

    // dir:<path> or folder:<path>
    const dirMatch = line.match(/^(?:dir|folder):\s*(.+)$/i);
    if (dirMatch) {
      directives.subdir = dirMatch[1].trim().replace(/^\/+|\/+$/g, '');
      continue;
    }

    // include:<glob>
    const includeMatch = line.match(/^include:\s*(.+)$/i);
    if (includeMatch) {
      includePatterns.push(includeMatch[1].trim());
      continue;
    }

    // exclude:<glob>
    const excludeMatch = line.match(/^exclude:\s*(.+)$/i);
    if (excludeMatch) {
      excludePatterns.push(excludeMatch[1].trim());
      continue;
    }
  }

  // Fuzzy: "<word> only" or "only <word>" — attempt to detect a subdirectory hint
  if (!directives.subdir) {
    const fuzzyMatch = full.match(/\b(\w+)\s+only\b/i) || full.match(/\bonly\s+(\w+)\b/i);
    if (fuzzyMatch) {
      directives.subdir = fuzzyMatch[1];
      directives._fuzzySubdir = true; // mark as fuzzy so caller can validate
    }
  }

  if (includePatterns.length > 0) directives.includePatterns = includePatterns;
  if (excludePatterns.length > 0) directives.excludePatterns = excludePatterns;

  return directives;
}

/**
 * Resolve a fuzzy subdir hint by scanning the target directory for matching subdirectories.
 * For example, "week4" would match "programs/week4" or "contracts/week4".
 *
 * @param {string} targetDir — the cloned repo root
 * @param {string} hint — the fuzzy subdirectory hint (e.g. "week4")
 * @returns {string|null} — resolved relative subdirectory path, or null if no match
 */
function resolveFuzzySubdir(targetDir, hint) {
  if (!hint || !targetDir) return null;

  const lowerHint = hint.toLowerCase();
  const matches = [];

  // Walk up to 3 levels deep looking for directories matching the hint
  function scan(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;

      const lowerName = entry.name.toLowerCase();
      if (lowerName.includes(lowerHint)) {
        const rel = path.relative(targetDir, path.join(dir, entry.name));
        matches.push(rel);
      }
      scan(path.join(dir, entry.name), depth + 1);
    }
  }

  scan(targetDir, 0);

  if (matches.length === 0) return null;

  // Prefer exact name match over substring match
  const exact = matches.find(m => path.basename(m).toLowerCase() === lowerHint);
  return exact || matches[0];
}

/**
 * Check if a file path matches a glob-like pattern using simple path-prefix matching.
 * Supports:
 *   programs/week4/**  — matches anything under programs/week4/
 *   **\/tests/**        — matches any path containing /tests/
 *   *.rs               — matches any .rs file
 *
 * @param {string} filePath — relative file path
 * @param {string} pattern — glob-like pattern
 * @returns {boolean}
 */
function matchesPattern(filePath, pattern) {
  // Normalize
  const fp = filePath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');

  // "**/<segment>/**" — match any path containing that segment
  const containsMatch = pat.match(/^\*\*\/(.+?)\/\*\*$/);
  if (containsMatch) {
    const segment = containsMatch[1];
    return fp.includes('/' + segment + '/') || fp.startsWith(segment + '/');
  }

  // "<prefix>/**" — match anything under that prefix
  if (pat.endsWith('/**')) {
    const prefix = pat.slice(0, -3);
    return fp.startsWith(prefix + '/') || fp === prefix;
  }

  // "*.<ext>" — match by extension
  if (pat.startsWith('*.')) {
    const ext = pat.slice(1); // e.g. ".rs"
    return fp.endsWith(ext);
  }

  // Exact prefix match (no glob)
  return fp.startsWith(pat) || fp === pat;
}

module.exports = { parseScopeDirectives, resolveFuzzySubdir, matchesPattern };
