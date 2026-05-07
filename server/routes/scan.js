const express = require('express');
const { readJSON, readScan, withLock, readProgress, writeProgress, getStateDir } = require('../lib/state-io');
const { startPipeline, cancelScan, getActiveScan, runPrescan } = require('../lib/agent-runner');
const router = express.Router();

// POST /api/scan/start — kick off the async scan pipeline
router.post('/start', (req, res) => {
  // Check for active scan
  if (getActiveScan()) {
    return res.status(409).json({ error: 'A scan is already running' });
  }

  // Read required state
  const audit = readJSON('audit.json');
  const scope = readJSON('scope.json');

  if (!audit) {
    return res.status(400).json({ error: 'No audit configuration found. Complete setup first.' });
  }
  if (!scope || !scope.accepted) {
    return res.status(400).json({ error: 'Scope not accepted. Accept scope first.' });
  }
  if (!audit.localPath && !audit.repoUrl) {
    return res.status(400).json({ error: 'No target path configured in audit settings.' });
  }

  // Return 202 immediately, run pipeline in background
  res.status(202).json({ ok: true, message: 'Scan started' });

  // Fire and forget — errors handled internally
  startPipeline(audit, scope).catch(err => {
    console.error('Pipeline fatal error:', err);
  });
});

// GET /api/scan/status — current scan status with file-based fallback
router.get('/status', (req, res) => {
  const scan = getActiveScan();
  if (scan) {
    return res.json({
      running: scan.running,
      startedAt: scan.startedAt,
      agentCount: scan.pids.length,
    });
  }

  // File-based fallback for timestamps after scan completes
  const saved = readScan();
  if (saved) {
    return res.json({
      running: false,
      startedAt: saved.startedAt || null,
      finishedAt: saved.finishedAt || null,
    });
  }

  return res.json({ running: false });
});

// POST /api/scan/retry-prescan — re-run prescan and update progress
router.post('/retry-prescan', async (req, res) => {
  const audit = readJSON('audit.json');
  if (!audit || (!audit.localPath && !audit.repoUrl)) {
    return res.status(400).json({ error: 'No target path configured.' });
  }

  const stateDir = getStateDir();
  const targetDir = audit.localPath || '';

  res.status(202).json({ ok: true, message: 'Retrying prescan' });

  try {
    const result = await runPrescan(targetDir, stateDir);
    await withLock(() => {
      const p = readProgress();
      p.prescanWarning = result.warning;
      writeProgress(p);
    });
  } catch (err) {
    console.error('Prescan retry error:', err);
  }
});

// POST /api/scan/cancel — stop the active scan
router.post('/cancel', (req, res) => {
  const cancelled = cancelScan();
  if (!cancelled) {
    return res.status(404).json({ error: 'No active scan to cancel' });
  }
  res.json({ ok: true, message: 'Scan cancelled' });
});

module.exports = router;
