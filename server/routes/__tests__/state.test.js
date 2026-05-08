const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

let app;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Clear module cache to pick up new env
  delete require.cache[require.resolve('../../routes/state')];
  const stateRoutes = require('../../routes/state');

  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/state', stateRoutes);
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('GET /api/state/:file', () => {
  it('returns null when no file exists', async () => {
    const res = await request(app).get('/api/state/audit');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns data after PUT', async () => {
    // Write first
    await request(app)
      .put('/api/state/audit')
      .send({ repoUrl: 'https://github.com/test/repo' })
      .expect(200);

    // Read back
    const res = await request(app).get('/api/state/audit');
    expect(res.status).toBe(200);
    expect(res.body.repoUrl).toBe('https://github.com/test/repo');
  });

  it('returns 400 for unknown state file', async () => {
    const res = await request(app).get('/api/state/unknown');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown state file');
  });
});

describe('PUT /api/state/:file', () => {
  it('succeeds for writable file (audit)', async () => {
    const res = await request(app)
      .put('/api/state/audit')
      .send({ model: 'sonnet' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 for read-only file (findings)', async () => {
    const res = await request(app)
      .put('/api/state/findings')
      .send({ findings: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('read-only');
  });

  it('returns 403 for read-only file (progress)', async () => {
    const res = await request(app)
      .put('/api/state/progress')
      .send({ phase: 'done' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for read-only file (leads)', async () => {
    const res = await request(app)
      .put('/api/state/leads')
      .send({ leads: [] });
    expect(res.status).toBe(403);
  });

  it('returns 400 for array body', async () => {
    const res = await request(app)
      .put('/api/state/audit')
      .send([1, 2, 3]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
  });

  it('returns 400 for null body', async () => {
    const res = await request(app)
      .put('/api/state/audit')
      .set('Content-Type', 'application/json')
      .send('null');
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown state file', async () => {
    const res = await request(app)
      .put('/api/state/unknown')
      .send({ data: true });
    expect(res.status).toBe(400);
  });

  it('returns 413 for oversized body', async () => {
    const largeObj = { data: 'x'.repeat(600 * 1024) };
    const res = await request(app)
      .put('/api/state/audit')
      .send(largeObj);
    expect(res.status).toBe(413);
  });
});
