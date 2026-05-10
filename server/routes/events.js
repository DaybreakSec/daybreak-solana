const express = require('express');
const bus = require('../lib/event-bus');
const { readProgress, readFindings } = require('../lib/state-io');
const router = express.Router();

// GET /api/scan/events - SSE endpoint for real-time pipeline updates
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send current state on connect
  const progress = readProgress();
  if (progress && Object.keys(progress).length > 0) {
    res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
  }

  const findings = readFindings();
  if (findings.findings && findings.findings.length > 0) {
    res.write(`event: finding\ndata: ${JSON.stringify({ count: findings.findings.length })}\n\n`);
  }

  function onProgress(data) {
    res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function onLog(data) {
    res.write(`event: log\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function onFinding(data) {
    res.write(`event: finding\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function onCost(data) {
    res.write(`event: cost\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function onDone(data) {
    res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
  }

  bus.on('progress', onProgress);
  bus.on('log', onLog);
  bus.on('finding', onFinding);
  bus.on('cost', onCost);
  bus.on('done', onDone);

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('progress', onProgress);
    bus.off('log', onLog);
    bus.off('finding', onFinding);
    bus.off('cost', onCost);
    bus.off('done', onDone);
  });
});

module.exports = router;
