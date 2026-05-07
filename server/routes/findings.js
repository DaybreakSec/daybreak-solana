const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

function getFindingsPath() {
  const stateDir = process.env.AUDIT_STATE_DIR || path.join(process.cwd(), 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return path.join(stateDir, 'findings.json');
}

function readFindings() {
  const filepath = getFindingsPath();
  if (!fs.existsSync(filepath)) {
    return { findings: [] };
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function writeFindings(data) {
  fs.writeFileSync(getFindingsPath(), JSON.stringify(data, null, 2));
}

// GET /api/findings - read findings with optional filters
router.get('/', (req, res) => {
  try {
    const data = readFindings();
    let findings = data.findings || [];

    // Apply filters
    if (req.query.severity) {
      findings = findings.filter(f => f.severity === req.query.severity);
    }
    if (req.query.agent) {
      findings = findings.filter(f => f.agent === req.query.agent);
    }
    if (req.query.bugClass) {
      findings = findings.filter(f => f.bugClass === req.query.bugClass);
    }
    if (req.query.status) {
      findings = findings.filter(f => f.status === req.query.status);
    }

    res.json({ findings, total: data.findings ? data.findings.length : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/findings/:id - update finding triage
router.put('/:id', (req, res) => {
  try {
    const data = readFindings();
    const idx = data.findings.findIndex(f => f.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Finding not found' });
    }

    const allowed = ['status', 'severity', 'notes', 'triageReason'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data.findings[idx][key] = req.body[key];
      }
    }
    data.findings[idx].triagedAt = new Date().toISOString();

    writeFindings(data);
    res.json(data.findings[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
