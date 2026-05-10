const fs = require('fs');
const path = require('path');
const { validatePath } = require('./path-validator');
const { wrapSourceFile } = require('./sanitizer');

const TOKEN_BUDGET = 150000; // leave room for system prompt + output

const EXT_LANG = {
  '.rs': 'rust',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.lock': 'toml',
};

function detectLang(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_LANG[ext] || '';
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Read in-scope files and format them for the agent prompt.
 *
 * @param {string} rootDir - The root directory of the target project
 * @param {Array<{path: string, loc: number}>} files - In-scope file list from scope.json
 * @param {string[]} excludedFiles - Paths to exclude
 * @param {string[]} [priorityKeywords] - Keywords to boost file priority (for agent domain)
 * @returns {{ formatted: string, totalLoc: number, totalTokens: number, warning: string|null, includedFiles: string[], excludedByBudget: string[] }}
 */
function readSourceFiles(rootDir, files, excludedFiles = [], priorityKeywords = []) {
  const excluded = new Set(excludedFiles);
  const inScope = files.filter(f => !excluded.has(f.path));

  // Read file contents
  const fileData = [];
  const excludedByError = [];
  for (const f of inScope) {
    const fullPath = validatePath(rootDir, f.path);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const tokens = estimateTokens(content);
      const lines = content.split('\n').length;

      // Score: files matching priority keywords get boosted
      let score = lines; // base score = LOC (larger files first)
      if (priorityKeywords.length > 0) {
        const lowerPath = f.path.toLowerCase();
        for (const kw of priorityKeywords) {
          if (lowerPath.includes(kw.toLowerCase())) {
            score += 100000; // large boost for keyword match
            break;
          }
        }
      }

      fileData.push({
        path: f.path,
        content,
        loc: lines,
        tokens,
        score,
      });
    } catch (err) {
      excludedByError.push({ path: f.path, reason: err.code || err.message });
    }
  }

  // Sort by score descending (keyword-matching files first, then by LOC)
  fileData.sort((a, b) => b.score - a.score);

  // Include files until budget exhausted
  let usedTokens = 0;
  const included = [];
  const excludedByBudget = [];
  let warning = null;

  for (const f of fileData) {
    if (usedTokens + f.tokens <= TOKEN_BUDGET) {
      included.push(f);
      usedTokens += f.tokens;
    } else {
      excludedByBudget.push(f.path);
    }
  }

  if (excludedByBudget.length > 0) {
    warning = `Large codebase, source truncated to fit context. ${excludedByBudget.length} file(s) excluded by budget.`;
  }
  if (excludedByError.length > 0) {
    const errMsg = `${excludedByError.length} file(s) unreadable: ${excludedByError.map(e => e.path).join(', ')}`;
    warning = warning ? `${warning} ${errMsg}` : errMsg;
  }

  // Format output with injection-resistant XML delimiters
  const parts = [];
  for (const f of included) {
    parts.push(wrapSourceFile(f.path, f.content, f.loc));
  }

  const totalLoc = included.reduce((sum, f) => sum + f.loc, 0);

  return {
    formatted: parts.join('\n\n'),
    totalLoc,
    totalTokens: usedTokens,
    warning,
    includedFiles: included.map(f => f.path),
    excludedByBudget,
    excludedByError,
  };
}

module.exports = { readSourceFiles, estimateTokens, detectLang };
