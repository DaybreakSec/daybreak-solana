const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

let app;
let tmpDir;

const mockAgentRunner = {
  getActiveScan: vi.fn().mockReturnValue(null),
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audits-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Reset mocks to defaults
  mockAgentRunner.getActiveScan.mockReturnValue(null);

  // Inject mock into require cache before loading the route
  const agentRunnerPath = require.resolve('../../lib/agent-runner');
  require.cache[agentRunnerPath] = {
    id: agentRunnerPath,
    filename: agentRunnerPath,
    loaded: true,
    exports: mockAgentRunner,
  };

  // Clear state-io and route caches so they pick up new AUDIT_STATE_DIR
  delete require.cache[require.resolve('../../lib/state-io')];
  delete require.cache[require.resolve('../../routes/audits')];
  const auditsRoutes = require('../../routes/audits');

  app = express();
  app.use(express.json());
  app.use('/api/audits', auditsRoutes);
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('GET /api/audits/:id - active-scan guard', () => {
  it('returns 409 when a scan is actively running', async () => {
    mockAgentRunner.getActiveScan.mockReturnValue({ running: true, startedAt: '2024-01-01', pids: [1234] });

    const res = await request(app).get('/api/audits/abcd1234');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Cannot load a saved audit while a scan is running');
  });

  it('returns 409 for any truthy getActiveScan value', async () => {
    // Even a minimal truthy object should trigger 409
    mockAgentRunner.getActiveScan.mockReturnValue({ running: true });

    const res = await request(app).get('/api/audits/abcd1234');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Cannot load a saved audit while a scan is running');
  });

  it('returns 400 for invalid audit ID format (not hex)', async () => {
    const res = await request(app).get('/api/audits/not-valid');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid audit ID');
  });

  it('returns 400 for audit ID too short', async () => {
    const res = await request(app).get('/api/audits/abc123');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid audit ID');
  });

  it('returns 400 for audit ID too long', async () => {
    const res = await request(app).get('/api/audits/abcdef1234');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid audit ID');
  });

  it('returns 400 for audit ID with uppercase chars', async () => {
    const res = await request(app).get('/api/audits/ABCD1234');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid audit ID');
  });

  it('returns 404 when snapshot directory does not exist', async () => {
    const res = await request(app).get('/api/audits/deadbeef');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Saved audit not found');
  });

  it('successfully loads a saved audit when no scan is running', async () => {
    // Set up saved-audits directory structure
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const savedDir = path.join(repoRoot, 'saved-audits');
    const snapshotId = 'a1b2c3d4';
    const snapshotDir = path.join(savedDir, snapshotId);

    // Create snapshot directory with state files
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapshotDir, 'audit.json'),
      JSON.stringify({ localPath: '/tmp/old-project', repoUrl: '' })
    );
    fs.writeFileSync(
      path.join(snapshotDir, 'findings.json'),
      JSON.stringify({ findings: [] })
    );

    // Create index with entry
    const indexPath = path.join(savedDir, 'index.json');
    const entry = {
      id: snapshotId,
      name: 'Test Audit',
      target: '/tmp/old-project',
      savedAt: '2024-01-15T00:00:00.000Z',
      findingsCount: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
      phase: 'done',
    };
    fs.writeFileSync(indexPath, JSON.stringify([entry]));

    const res = await request(app).get(`/api/audits/${snapshotId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(snapshotId);
    expect(res.body.name).toBe('Test Audit');

    // Verify state files were copied back
    expect(fs.existsSync(path.join(tmpDir, 'audit.json'))).toBe(true);

    // Cleanup
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    fs.unlinkSync(indexPath);
    // Remove saved-audits dir if empty
    try { fs.rmdirSync(savedDir); } catch {}
  });
});

describe('GET /api/audits - list saved audits', () => {
  it('returns empty array when no saved audits exist', async () => {
    const res = await request(app).get('/api/audits');
    expect(res.status).toBe(200);
    expect(res.body.audits).toEqual([]);
  });
});

describe('POST /api/audits - save current audit', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/audits')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name is required');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await request(app)
      .post('/api/audits')
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name is required');
  });

  it('returns 400 when name is not a string', async () => {
    const res = await request(app)
      .post('/api/audits')
      .send({ name: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name is required');
  });

  it('successfully saves an audit with valid name', async () => {
    // Seed audit state
    fs.writeFileSync(
      path.join(tmpDir, 'audit.json'),
      JSON.stringify({ localPath: '/tmp/project', repoUrl: '' })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'findings.json'),
      JSON.stringify({ findings: [] })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'progress.json'),
      JSON.stringify({ phase: 'done' })
    );

    const res = await request(app)
      .post('/api/audits')
      .send({ name: 'My Test Audit' });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[a-f0-9]{8}$/);
    expect(res.body.name).toBe('My Test Audit');
    expect(res.body.target).toBe('/tmp/project');
    expect(res.body.phase).toBe('done');

    // Cleanup: remove saved snapshot
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const savedDir = path.join(repoRoot, 'saved-audits');
    const snapshotDir = path.join(savedDir, res.body.id);
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
    // Clean up index
    const indexPath = path.join(savedDir, 'index.json');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
    try { fs.rmdirSync(savedDir); } catch {}
  });

  it('truncates name to 100 characters', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'audit.json'),
      JSON.stringify({ localPath: '/tmp/project' })
    );

    const longName = 'A'.repeat(200);
    const res = await request(app)
      .post('/api/audits')
      .send({ name: longName });
    expect(res.status).toBe(200);
    expect(res.body.name.length).toBe(100);

    // Cleanup
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const savedDir = path.join(repoRoot, 'saved-audits');
    const snapshotDir = path.join(savedDir, res.body.id);
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
    const indexPath = path.join(savedDir, 'index.json');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
    try { fs.rmdirSync(savedDir); } catch {}
  });
});

describe('DELETE /api/audits/:id', () => {
  it('returns 400 for invalid ID format', async () => {
    const res = await request(app).delete('/api/audits/invalid!');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid audit ID');
  });

  it('succeeds even when snapshot does not exist (idempotent)', async () => {
    const res = await request(app).delete('/api/audits/deadbeef');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
