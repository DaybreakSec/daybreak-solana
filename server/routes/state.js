const express = require('express');
const fs = require('fs');
const path = require('path');
const { getStateDir } = require('../lib/state-io');
const router = express.Router();

const ALLOWED_STATE_FILES = [
  'audit', 'sanitize', 'scope', 'progress', 'leads',
  'findings', 'ast-grep-results', 'clippy-results',
  'cargo-audit-results', 'accounts', 'cpis', 'pdas',
  'instructions', 'mir-results',
  'threat-model',
];

// GET /api/state/:file - read a state JSON file
router.get('/:file', (req, res) => {
  const filename = req.params.file.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!ALLOWED_STATE_FILES.includes(filename)) {
    return res.status(400).json({ error: `Unknown state file: ${filename}` });
  }

  const stateDir = getStateDir();
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

// Files that the API can write. Pipeline-managed files are read-only.
const WRITABLE_FILES = ['audit', 'scope', 'sanitize'];
const MAX_STATE_SIZE = 512 * 1024; // 512KB
const MAX_STRING_FIELD_LENGTH = 10_000;

// Lightweight schema validators for writable state files
const STATE_SCHEMAS = {
  audit: (body) => {
    const allowed = ['repoUrl', 'localPath', 'mode', 'model', 'agentTimeoutMs', 'maxTokenBudget', 'scopeNotes', 'name'];
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) return `Unknown field: ${key}`;
      if (typeof body[key] === 'string' && body[key].length > MAX_STRING_FIELD_LENGTH) {
        return `Field '${key}' exceeds max length`;
      }
    }
    if (body.mode && !['local', 'git'].includes(body.mode)) return 'Invalid mode';
    if (body.model && typeof body.model !== 'string') return 'model must be a string';
    if (body.agentTimeoutMs !== undefined && (typeof body.agentTimeoutMs !== 'number' || body.agentTimeoutMs < 0)) {
      return 'agentTimeoutMs must be a non-negative number';
    }
    if (body.maxTokenBudget !== undefined && (typeof body.maxTokenBudget !== 'number' || body.maxTokenBudget < 0)) {
      return 'maxTokenBudget must be a non-negative number';
    }
    return null;
  },
  scope: (body) => {
    if (body.files !== undefined && !Array.isArray(body.files)) return 'files must be an array';
    if (body.excludedFiles !== undefined && !Array.isArray(body.excludedFiles)) return 'excludedFiles must be an array';
    if (body.framework !== undefined && typeof body.framework !== 'string') return 'framework must be a string';
    if (body.accepted !== undefined && typeof body.accepted !== 'boolean') return 'accepted must be a boolean';
    return null;
  },
  sanitize: () => null,
};

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

  // Schema validation for known writable files
  const validator = STATE_SCHEMAS[filename];
  if (validator) {
    const error = validator(req.body);
    if (error) return res.status(400).json({ error });
  }

  const serialized = JSON.stringify(req.body, null, 2);
  if (serialized.length > MAX_STATE_SIZE) {
    return res.status(413).json({ error: `State file exceeds max size of ${MAX_STATE_SIZE} bytes` });
  }

  const stateDir = getStateDir();
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
