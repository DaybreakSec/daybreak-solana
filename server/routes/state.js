const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const ALLOWED_STATE_FILES = [
  'audit', 'sanitize', 'scope', 'progress', 'leads',
  'findings', 'ast-grep-results', 'clippy-results',
  'cargo-audit-results', 'accounts', 'cpis', 'pdas',
  'instructions', 'mir-results',
  'threat-model',
];

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function getStateDir() {
  return process.env.AUDIT_STATE_DIR || path.join(REPO_ROOT, 'state');
}

function ensureStateDir() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// GET /api/state/:file - read a state JSON file
router.get('/:file', (req, res) => {
  const filename = req.params.file.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!ALLOWED_STATE_FILES.includes(filename)) {
    return res.status(400).json({ error: `Unknown state file: ${filename}` });
  }

  const stateDir = ensureStateDir();
  const filepath = path.join(stateDir, `${filename}.json`);

  if (!fs.existsSync(filepath)) {
    return res.json(null);
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Failed to read ${filename}` });
  }
});

// Files that the API can write — pipeline-managed files are read-only
const WRITABLE_FILES = ['audit', 'scope', 'sanitize'];
const MAX_STATE_SIZE = 512 * 1024; // 512KB

// PUT /api/state/:file - write/update a state JSON file
router.put('/:file', (req, res) => {
  const filename = req.params.file.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!ALLOWED_STATE_FILES.includes(filename)) {
    return res.status(400).json({ error: `Unknown state file: ${filename}` });
  }

  if (!WRITABLE_FILES.includes(filename)) {
    return res.status(403).json({ error: `State file '${filename}' is read-only via API` });
  }

  // Validate body is a non-null, non-array object
  if (req.body === null || req.body === undefined || Array.isArray(req.body) || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const serialized = JSON.stringify(req.body, null, 2);
  if (serialized.length > MAX_STATE_SIZE) {
    return res.status(413).json({ error: `State file exceeds max size of ${MAX_STATE_SIZE} bytes` });
  }

  const stateDir = ensureStateDir();
  const filepath = path.join(stateDir, `${filename}.json`);

  try {
    const tmp = filepath + '.tmp';
    fs.writeFileSync(tmp, serialized);
    fs.renameSync(tmp, filepath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write ${filename}` });
  }
});

module.exports = router;
