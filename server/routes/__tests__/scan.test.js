const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

let app;
let tmpDir;

const mockAgentRunner = {
  getActiveScan: vi.fn().mockReturnValue(null),
  startPipeline: vi.fn().mockResolvedValue(undefined),
  cancelScan: vi.fn().mockReturnValue(true),
  runPrescan: vi.fn().mockResolvedValue({ ok: true, warning: null }),
  resolveTargetDir: vi.fn().mockReturnValue('/tmp/test-project'),
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Reset mocks to defaults
  mockAgentRunner.getActiveScan.mockReturnValue(null);
  mockAgentRunner.startPipeline.mockResolvedValue(undefined);

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
  delete require.cache[require.resolve('../../routes/scan')];
  const scanRoutes = require('../../routes/scan');

  app = express();
  app.use(express.json());
  app.use('/api/scan', scanRoutes);
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('GET /api/scan/browse - security (blocked directories)', () => {
  it('blocks /etc system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/etc');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
    expect(res.body.error).toContain('/etc');
  });

  it('blocks /var system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/var');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /proc system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/proc');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /sys system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/sys');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /dev system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/dev');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /root system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/root');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /boot system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/boot');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /lost+found system directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/lost%2Bfound');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks subdirectories of system dirs (e.g. /etc/passwd)', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/etc/ssh');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse system directory');
  });

  it('blocks /.ssh sensitive suffix', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.ssh');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('blocks /.gnupg sensitive suffix', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.gnupg');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('blocks /.aws sensitive suffix', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.aws');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('blocks /.config/claude sensitive suffix', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.config/claude');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('blocks /.env sensitive suffix', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.env');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('blocks subdirectories of sensitive dirs (e.g. /.ssh/keys)', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/home/user/.ssh/keys');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cannot browse sensitive directory');
  });

  it('returns 404 for non-existent directory', async () => {
    const res = await request(app).get('/api/scan/browse?dir=/tmp/nonexistent-dir-xyz-999');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Directory not found');
  });

  it('successfully lists a valid directory', async () => {
    // Create a test directory with subdirs and indicator files
    const testDir = path.join(tmpDir, 'project');
    fs.mkdirSync(testDir);
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.mkdirSync(path.join(testDir, 'programs'));
    fs.writeFileSync(path.join(testDir, 'Cargo.toml'), '');
    fs.writeFileSync(path.join(testDir, 'Anchor.toml'), '');

    const res = await request(app).get(`/api/scan/browse?dir=${testDir}`);
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(testDir);
    expect(res.body.dirs).toContain('src');
    expect(res.body.dirs).toContain('programs');
    expect(res.body.indicators.hasCargo).toBe(true);
    expect(res.body.indicators.hasAnchor).toBe(true);
    expect(res.body.indicators.hasPrograms).toBe(true);
    expect(res.body.indicators.hasSrc).toBe(true);
  });

  it('defaults to root when no dir param provided', async () => {
    const res = await request(app).get('/api/scan/browse');
    // Should succeed (root exists) or at least not be a 403
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('/');
  });

  it('does not list hidden directories (dotfiles)', async () => {
    const testDir = path.join(tmpDir, 'project2');
    fs.mkdirSync(testDir);
    fs.mkdirSync(path.join(testDir, '.git'));
    fs.mkdirSync(path.join(testDir, 'src'));

    const res = await request(app).get(`/api/scan/browse?dir=${testDir}`);
    expect(res.status).toBe(200);
    expect(res.body.dirs).not.toContain('.git');
    expect(res.body.dirs).toContain('src');
  });
});

describe('POST /api/scan/start - conflict handling', () => {
  it('returns 409 when a scan is already running', async () => {
    mockAgentRunner.getActiveScan.mockReturnValue({ running: true, startedAt: '2024-01-01', pids: [] });

    const res = await request(app).post('/api/scan/start').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('scan is already running');
  });

  it('returns 400 when no audit configuration exists', async () => {
    // No audit.json in tmpDir
    const res = await request(app).post('/api/scan/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No audit configuration');
  });

  it('returns 400 when scope not accepted', async () => {
    // Create audit.json but no accepted scope
    fs.writeFileSync(
      path.join(tmpDir, 'audit.json'),
      JSON.stringify({ localPath: '/tmp/test', repoUrl: '' })
    );
    // scope.json without accepted flag
    fs.writeFileSync(
      path.join(tmpDir, 'scope.json'),
      JSON.stringify({ files: [], accepted: false })
    );

    const res = await request(app).post('/api/scan/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Scope not accepted');
  });

  it('returns 400 when no target path configured', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'audit.json'),
      JSON.stringify({ localPath: '', repoUrl: '' })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'scope.json'),
      JSON.stringify({ files: [], accepted: true })
    );

    const res = await request(app).post('/api/scan/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No target path');
  });

  it('returns 202 when all preconditions are met', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'audit.json'),
      JSON.stringify({ localPath: '/tmp/test-project', repoUrl: '' })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'scope.json'),
      JSON.stringify({ files: [], accepted: true })
    );

    const res = await request(app).post('/api/scan/start').send({});
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toContain('Scan started');
  });
});
