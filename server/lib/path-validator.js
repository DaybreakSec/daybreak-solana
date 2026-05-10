const path = require('path');
const fs = require('fs');

/**
 * Resolve a file path and verify it stays within rootDir.
 * Handles ../, symlinks, etc. Throws on escape.
 */
function validatePath(rootDir, filePath) {
  const resolved = path.resolve(rootDir, filePath);
  const realRoot = fs.realpathSync(rootDir);
  let realResolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    // File may not exist yet - check the resolved path prefix
    realResolved = resolved;
  }
  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
    throw new Error(`Path escapes root directory: ${filePath}`);
  }
  return realResolved;
}

const ALLOWED_GIT_HOSTS = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|sr\.ht)\//;
const SHELL_META = /[;&|`$(){}!#\n\r]/;

/**
 * Validate a git URL. Only allows https:// URLs from known hosts.
 * Blocks file://, ssh://, and shell metacharacters.
 */
function isValidGitUrl(url) {
  if (typeof url !== 'string') return false;
  if (SHELL_META.test(url)) return false;
  return ALLOWED_GIT_HOSTS.test(url);
}

const FINDING_ID_RE = /^[a-z][-a-z]+-\d{3}$/;

/**
 * Validate a finding ID matches the expected pattern.
 */
function isValidFindingId(id) {
  return typeof id === 'string' && FINDING_ID_RE.test(id);
}

module.exports = { validatePath, isValidGitUrl, isValidFindingId };
