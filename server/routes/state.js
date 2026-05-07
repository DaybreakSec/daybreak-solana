const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

function getStateDir() {
  return process.env.AUDIT_STATE_DIR || path.join(process.cwd(), 'state');
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
  const stateDir = ensureStateDir();
  const filename = req.params.file.replace(/[^a-zA-Z0-9_-]/g, '');
  const filepath = path.join(stateDir, `${filename}.json`);

  if (!fs.existsSync(filepath)) {
    return res.json(null);
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Failed to read ${filename}: ${err.message}` });
  }
});

// PUT /api/state/:file - write/update a state JSON file
router.put('/:file', (req, res) => {
  const stateDir = ensureStateDir();
  const filename = req.params.file.replace(/[^a-zA-Z0-9_-]/g, '');
  const filepath = path.join(stateDir, `${filename}.json`);

  try {
    fs.writeFileSync(filepath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write ${filename}: ${err.message}` });
  }
});

module.exports = router;
