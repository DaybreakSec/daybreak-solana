const express = require('express');
const { withLock, readFindings, writeFindings } = require('../lib/state-io');
const { isValidFindingId } = require('../lib/path-validator');
const router = express.Router();

const VALID_STATUSES = ['pending', 'valid', 'invalid', 'not-important', 'out-of-scope'];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };

// GET /api/findings - read findings with optional filters, search, and sort
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

    // Text search across title, description, file, bugClass
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      findings = findings.filter(f =>
        (f.title || '').toLowerCase().includes(q)
        || (f.description || '').toLowerCase().includes(q)
        || (f.file || '').toLowerCase().includes(q)
        || (f.bugClass || '').toLowerCase().includes(q)
      );
    }

    // Sort
    if (req.query.sort) {
      const sortKey = req.query.sort;
      findings.sort((a, b) => {
        if (sortKey === 'severity') {
          return (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5);
        }
        if (sortKey === 'confidence') {
          const confRank = { high: 0, medium: 1, low: 2 };
          return (confRank[a.confidence] ?? 3) - (confRank[b.confidence] ?? 3);
        }
        if (sortKey === 'file') {
          return (a.file || '').localeCompare(b.file || '');
        }
        if (sortKey === 'agent') {
          return (a.agent || '').localeCompare(b.agent || '');
        }
        return 0;
      });
    }

    res.json({ findings, total: data.findings ? data.findings.length : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read findings' });
  }
});

// PUT /api/findings/:id - update finding triage
router.put('/:id', async (req, res) => {
  if (!isValidFindingId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid finding ID format' });
  }

  try {
    // Validate enum fields before acquiring lock
    if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if (req.body.severity !== undefined && !VALID_SEVERITIES.includes(req.body.severity)) {
      return res.status(400).json({ error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    if (req.body.triageReason !== undefined && (typeof req.body.triageReason !== 'string' || req.body.triageReason.length > 2000)) {
      return res.status(400).json({ error: 'triageReason must be a string of at most 2000 characters' });
    }
    if (req.body.notes !== undefined && (typeof req.body.notes !== 'string' || req.body.notes.length > 5000)) {
      return res.status(400).json({ error: 'notes must be a string of at most 5000 characters' });
    }

    const result = await withLock(() => {
      const data = readFindings();
      const idx = data.findings.findIndex(f => f.id === req.params.id);

      if (idx === -1) return { status: 404, body: { error: 'Finding not found' } };

      const allowed = ['status', 'severity', 'notes', 'triageReason'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          data.findings[idx][key] = req.body[key];
        }
      }
      data.findings[idx].triagedAt = new Date().toISOString();

      writeFindings(data);
      return { status: 200, body: data.findings[idx] };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update finding' });
  }
});

// POST /api/findings/bulk-triage - update multiple findings at once
router.post('/bulk-triage', async (req, res) => {
  const { ids, status, triageReason } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'Cannot bulk-triage more than 500 findings at once' });
  }
  if (!ids.every(id => isValidFindingId(id))) {
    return res.status(400).json({ error: 'All ids must be valid finding IDs' });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (triageReason !== undefined && (typeof triageReason !== 'string' || triageReason.length > 2000)) {
    return res.status(400).json({ error: 'triageReason must be a string of at most 2000 characters' });
  }

  try {
    const result = await withLock(() => {
      const data = readFindings();
      const idSet = new Set(ids);
      let updated = 0;

      for (const f of data.findings) {
        if (idSet.has(f.id)) {
          f.status = status;
          if (triageReason) f.triageReason = triageReason;
          f.triagedAt = new Date().toISOString();
          updated++;
        }
      }

      writeFindings(data);
      return { updated };
    });

    res.json({ ok: true, updated: result.updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to bulk update findings' });
  }
});

module.exports = router;
