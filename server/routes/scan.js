const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { readJSON, readScan, withLock, readProgress, writeProgress, writeJSON, getStateDir } = require('../lib/state-io');
const { startPipeline, cancelScan, getActiveScan, runPrescan, resolveTargetDir } = require('../lib/agent-runner');
const router = express.Router();

const fs = require('fs');
const { parseScopeDirectives, resolveFuzzySubdir } = require('../lib/scope-resolver');

const BLOCKED_DIRS = ['/etc', '/var', '/proc', '/sys', '/dev', '/root', '/boot', '/lost+found'];
const BLOCKED_SUFFIXES = ['/.ssh', '/.gnupg', '/.aws', '/.config/claude', '/.env'];

// GET /api/scan/browse - list directories for local path selection
router.get('/browse', (req, res) => {
  const dir = req.query.dir || '/';
  const resolved = path.resolve(dir);

  // Block system directories
  for (const blocked of BLOCKED_DIRS) {
    if (resolved === blocked || resolved.startsWith(blocked + '/')) {
      return res.status(403).json({ error: `Cannot browse system directory: ${blocked}` });
    }
  }

  // Block sensitive dotfile directories
  for (const suffix of BLOCKED_SUFFIXES) {
    if (resolved.endsWith(suffix) || resolved.includes(suffix + '/')) {
      return res.status(403).json({ error: 'Cannot browse sensitive directory' });
    }
  }

  try {
    if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isDirectory()) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();

    // Check for Rust/Solana project indicators
    const files = entries.map(e => e.name);
    const indicators = {
      hasCargo: files.includes('Cargo.toml'),
      hasAnchor: files.includes('Anchor.toml'),
      hasPackageJson: files.includes('package.json'),
      hasPrograms: files.includes('programs'),
      hasSrc: files.includes('src'),
    };

    res.json({
      path: resolved,
      parent: path.dirname(resolved),
      dirs,
      indicators,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list directory: ' + err.message });
  }
});

// POST /api/scan/scope - generate scope analysis for a target
router.post('/scope', (req, res) => {
  const audit = readJSON('audit.json');
  if (!audit) {
    return res.status(400).json({ error: 'No audit configuration found. Complete setup first.' });
  }

  // Parse scope directives from scope notes
  const directives = parseScopeDirectives(audit.scopeNotes);

  let targetDir;
  try {
    targetDir = resolveTargetDir(audit, directives);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // If fuzzy subdir was set, resolve it now against the target
  if (directives._fuzzySubdir && directives.subdir) {
    const resolved = resolveFuzzySubdir(targetDir, directives.subdir);
    if (resolved) {
      directives.subdir = resolved;
      directives._fuzzySubdir = false;
      const narrowed = path.join(targetDir, resolved);
      if (fs.existsSync(narrowed) && fs.lstatSync(narrowed).isDirectory()) {
        targetDir = narrowed;
        console.log(`Fuzzy subdir resolved to: ${resolved}, narrowing scope to ${targetDir}`);
      }
    } else {
      console.warn(`Fuzzy subdir hint "${directives.subdir}" did not match, scanning full repo`);
      delete directives.subdir;
      delete directives._fuzzySubdir;
    }
  }

  // Return 202 immediately. Scope page polls for the result.
  res.status(202).json({ ok: true, message: 'Scope analysis started' });

  // Spawn scope.sh in the background
  const repoRoot = path.resolve(__dirname, '..', '..');
  const scopeScript = path.join(repoRoot, 'scripts', 'scope.sh');
  const proc = spawn('bash', [scopeScript, targetDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`scope.sh exited with code ${code}: ${stderr}`);
      return;
    }
    try {
      const scopeData = JSON.parse(stdout);

      // Attach resolved directives so the UI can display them
      const cleanDirectives = { ...directives };
      delete cleanDirectives._fuzzySubdir;
      if (Object.keys(cleanDirectives).length > 0) {
        scopeData.resolvedDirectives = cleanDirectives;
      }

      writeJSON('scope.json', scopeData);
    } catch (err) {
      console.error('Failed to parse scope.sh output:', err.message);
    }
  });

  proc.on('error', (err) => {
    console.error('scope.sh spawn error:', err.message);
  });
});

// POST /api/scan/start - kick off the async scan pipeline
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

  // Fire and forget; errors handled internally
  startPipeline(audit, scope).catch(err => {
    console.error('Pipeline fatal error:', err);
  });
});

// GET /api/scan/status - current scan status with file-based fallback
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

// POST /api/scan/retry-prescan - re-run prescan and update progress
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

// POST /api/scan/cancel - stop the active scan
router.post('/cancel', (req, res) => {
  const cancelled = cancelScan();
  if (!cancelled) {
    return res.status(404).json({ error: 'No active scan to cancel' });
  }
  res.json({ ok: true, message: 'Scan cancelled' });
});

module.exports = router;
