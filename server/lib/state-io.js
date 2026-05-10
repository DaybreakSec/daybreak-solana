const fs = require('fs');
const path = require('path');

// Shared promise-based write lock to prevent read-modify-write races
const LOCK_TIMEOUT_MS = 10_000;
let writeLock = Promise.resolve();
function withLock(fn) {
  const prev = writeLock;
  let release;
  writeLock = new Promise(resolve => { release = resolve; });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('state-io: lock held longer than 10s — refusing to proceed to prevent data corruption'));
    }, LOCK_TIMEOUT_MS);
  });
  return Promise.race([prev, timeout]).then(() => fn()).finally(release);
}

// Repo root is two levels up from server/lib/
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function getStateDir() {
  const dir = process.env.AUDIT_STATE_DIR || path.join(REPO_ROOT, 'state');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readJSON(filename) {
  const filepath = path.join(getStateDir(), filename);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function writeJSON(filename, data) {
  const filepath = path.join(getStateDir(), filename);
  const tmp = filepath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filepath);
}

function readFindings() {
  return readJSON('findings.json') || { findings: [] };
}

function writeFindings(data) {
  writeJSON('findings.json', data);
}

function readProgress() {
  return readJSON('progress.json') || {};
}

function writeProgress(data) {
  writeJSON('progress.json', data);
}

function readScan() {
  return readJSON('scan.json');
}

function writeScan(data) {
  writeJSON('scan.json', data);
}

module.exports = {
  withLock,
  getStateDir,
  readJSON,
  writeJSON,
  readFindings,
  writeFindings,
  readProgress,
  writeProgress,
  readScan,
  writeScan,
};
