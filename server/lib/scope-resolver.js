const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
 * Free-form scope notes (e.g. "just the bid wall program") are handled by
 * refineScopeWithLLM() separately — this function only handles structured patterns.
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

/**
 * Build a directory tree string for a target directory, up to maxDepth levels.
 * Skips hidden dirs, node_modules, and target/.
 *
 * @param {string} targetDir — root directory to scan
 * @param {number} maxDepth — maximum depth (default 3)
 * @returns {string} — formatted directory tree
 */
function buildDirTree(targetDir, maxDepth = 3) {
  const lines = [];

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'target')
      .sort((a, b) => a.name.localeCompare(b.name));

    for (let i = 0; i < dirs.length; i++) {
      const entry = dirs[i];
      const isLast = i === dirs.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      lines.push(prefix + connector + entry.name + '/');
      walk(path.join(dir, entry.name), depth + 1, prefix + childPrefix);
    }
  }

  lines.push(path.basename(targetDir) + '/');
  walk(targetDir, 0, '');
  return lines.join('\n');
}

/**
 * Read Cargo.toml files from the target directory to surface CPI/dependency info.
 * Returns a map of relative path → relevant dependency lines.
 *
 * @param {string} targetDir — root directory to scan
 * @returns {string} — formatted Cargo.toml dependency snippets
 */
function readCargoFiles(targetDir) {
  const snippets = [];

  function scan(dir, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'Cargo.toml' && entry.isFile()) {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
          const rel = path.relative(targetDir, path.join(dir, entry.name));
          // Extract [dependencies] and [dev-dependencies] sections
          const depSections = content.match(/\[(dependencies|dev-dependencies)\][\s\S]*?(?=\n\[|$)/g);
          if (depSections) {
            snippets.push(`--- ${rel} ---\n${depSections.join('\n')}`);
          }
        } catch {}
      }
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target') {
        scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  scan(targetDir, 0);
  return snippets.join('\n\n');
}

/**
 * Use Claude (haiku) to interpret free-form scope notes against the actual repo structure.
 * Identifies the target program AND any cross-program CPI dependencies.
 *
 * @param {string} targetDir — cloned repo root
 * @param {string} scopeNotes — user's free-form scope notes
 * @returns {Promise<{ primaryProgram: string, includePatterns?: string[], excludePatterns?: string[], reasoning: string }>}
 */
async function refineScopeWithLLM(targetDir, scopeNotes) {
  const dirTree = buildDirTree(targetDir, 3);
  const cargoInfo = readCargoFiles(targetDir);

  const systemPrompt = `You are a scope-resolution assistant for a Solana smart-contract auditor.
Given a repository directory tree, Cargo.toml dependency snippets, and the user's scope notes,
determine which program(s) the user wants to audit.

Rules:
- Identify the PRIMARY program directory the user is referring to (relative path from repo root).
- Check Cargo.toml dependencies to find cross-program invocation (CPI) targets — other programs
  in the same repo that the primary program calls or depends on.
- Return includePatterns as glob patterns (e.g. "programs/bid_wall/**") covering the primary
  program AND all its in-repo CPI dependencies.
- If the scope notes don't clearly refer to any specific program, set primaryProgram to "" and
  return empty includePatterns (meaning: scan everything).
- Be generous in interpretation: "just the bid wall program", "only bid_wall", "focus on bid wall",
  "bid wall" all mean the same thing.
- Return valid JSON matching the provided schema.`;

  const userPrompt = `Directory tree:
${dirTree}

Cargo.toml dependencies:
${cargoInfo || '(none found)'}

User scope notes: "${scopeNotes}"

Identify the target program and any CPI dependencies. Return JSON.`;

  const jsonSchema = JSON.stringify({
    type: 'object',
    properties: {
      primaryProgram: { type: 'string', description: 'Main program directory the user is targeting (relative path from repo root, e.g. "programs/bid_wall")' },
      includePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns for all directories to include (primary + CPI dependencies)',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns to exclude',
      },
      reasoning: { type: 'string', description: 'Brief explanation of interpretation and CPI dependencies found' },
    },
    required: ['primaryProgram', 'includePatterns', 'reasoning'],
  });

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--system-prompt', systemPrompt,
      '--output-format', 'json',
      '--json-schema', jsonSchema,
      '--model', 'haiku',
      '--no-session-persistence',
      '--tools', '',
    ];

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: process.env.HOME || '/home/daybreak',
        USER: process.env.USER || 'daybreak',
        SHELL: process.env.SHELL || '/bin/bash',
        LANG: process.env.LANG || 'en_US.UTF-8',
        TERM: process.env.TERM || 'dumb',
        CLAUDECODE: '',
        ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.stdin.write(userPrompt);
    proc.stdin.end();

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('LLM scope refinement timed out after 30s'));
    }, 30000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`LLM scope refinement exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`LLM scope refinement returned invalid JSON: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`LLM scope refinement spawn error: ${err.message}`));
    });
  });
}

module.exports = { parseScopeDirectives, resolveFuzzySubdir, matchesPattern, refineScopeWithLLM, buildDirTree };
