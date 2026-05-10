const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStateDir, readJSON } = require('../lib/state-io');
const { getActiveScan } = require('../lib/agent-runner');

const router = express.Router();
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const STATE_FILES = [
  'audit.json', 'scope.json', 'findings.json', 'progress.json', 'scan.json',
  'threat-model.json', 'scout.json', 'leads.json', 'sanitize.json',
  'accounts.json', 'cpis.json', 'pdas.json', 'instructions.json',
  'ast-grep-results.json', 'clippy-results.json', 'cargo-audit-results.json',
  'mir-results.json', 'oracles.json', 'close-patterns.json', 'value-flows.json',
  'state-machines.json', 'auth-patterns.json',
];

function getSavedDir() {
  const dir = path.join(REPO_ROOT, 'saved-audits');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readIndex() {
  const indexPath = path.join(getSavedDir(), 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function writeIndex(entries) {
  const indexPath = path.join(getSavedDir(), 'index.json');
  const tmp = indexPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, indexPath);
}

// GET /api/audits - list saved audits
router.get('/', (req, res) => {
  try {
    const entries = readIndex();
    res.json({ audits: entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list saved audits' });
  }
});

// POST /api/audits - save current audit
router.post('/', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    const sanitized = name.trim().slice(0, 100);
    const id = crypto.randomBytes(4).toString('hex');
    const stateDir = getStateDir();
    const snapshotDir = path.join(getSavedDir(), id);
    fs.mkdirSync(snapshotDir, { recursive: true });

    // Copy state files
    for (const file of STATE_FILES) {
      const src = path.join(stateDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(snapshotDir, file));
      }
    }

    // Build severity summary from findings
    const findings = readJSON('findings.json');
    const findingsCount = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
    if (findings && findings.findings) {
      for (const f of findings.findings) {
        if (f.status === 'valid' && findingsCount.hasOwnProperty(f.severity)) {
          findingsCount[f.severity]++;
        }
      }
    }

    // Read audit target
    const audit = readJSON('audit.json') || {};
    const progress = readJSON('progress.json') || {};

    const entry = {
      id,
      name: sanitized,
      target: audit.repoUrl || audit.localPath || '',
      savedAt: new Date().toISOString(),
      findingsCount,
      phase: progress.phase || 'unknown',
    };

    const entries = readIndex();
    entries.unshift(entry);
    writeIndex(entries);

    res.json(entry);
  } catch (err) {
    console.error('Failed to save audit:', err);
    res.status(500).json({ error: 'Failed to save audit' });
  }
});

// GET /api/audits/:id - load a saved audit back into state/
router.get('/:id', (req, res) => {
  try {
    // Refuse to overwrite state if a scan is actively running
    if (getActiveScan()) {
      return res.status(409).json({ error: 'Cannot load a saved audit while a scan is running' });
    }

    const { id } = req.params;
    if (!/^[a-f0-9]{8}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid audit ID' });
    }

    const snapshotDir = path.join(getSavedDir(), id);
    if (!fs.existsSync(snapshotDir)) {
      return res.status(404).json({ error: 'Saved audit not found' });
    }

    const stateDir = getStateDir();

    // Copy snapshot files back into state/
    for (const file of STATE_FILES) {
      const src = path.join(snapshotDir, file);
      const dest = path.join(stateDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      } else if (fs.existsSync(dest)) {
        // Remove state file if it wasn't in the snapshot
        fs.unlinkSync(dest);
      }
    }

    // Find and return the entry metadata
    const entries = readIndex();
    const entry = entries.find(e => e.id === id);

    res.json(entry || { id });
  } catch (err) {
    console.error('Failed to load audit:', err);
    res.status(500).json({ error: 'Failed to load audit' });
  }
});

// DELETE /api/audits/:id - delete a saved audit
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{8}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid audit ID' });
    }

    const snapshotDir = path.join(getSavedDir(), id);
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }

    const entries = readIndex();
    const filtered = entries.filter(e => e.id !== id);
    writeIndex(filtered);

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete audit:', err);
    res.status(500).json({ error: 'Failed to delete audit' });
  }
});

module.exports = router;
