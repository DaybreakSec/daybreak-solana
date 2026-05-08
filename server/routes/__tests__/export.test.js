const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

let app;
let tmpDir;

const SEED_FINDINGS = {
  findings: [
    {
      id: 'accounts-access-001',
      agent: 'accounts-access',
      title: 'Missing signer check',
      severity: 'high',
      confidence: 'high',
      file: 'src/lib.rs',
      line: 42,
      bugClass: 'missing-signer-check',
      description: 'No signer validation on admin instruction',
      proof: 'The instruction handler does not verify the signer',
      recommendation: 'Add signer constraint',
      status: 'valid',
    },
    {
      id: 'cpi-token-001',
      agent: 'cpi-token',
      title: 'Unchecked CPI return',
      severity: 'medium',
      confidence: 'medium',
      file: 'src/transfer.rs',
      line: 88,
      bugClass: 'unchecked-cpi',
      description: 'CPI return value not checked',
      proof: 'invoke() result is discarded',
      recommendation: 'Check CPI return value',
      status: 'valid',
    },
  ],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Seed findings
  fs.writeFileSync(path.join(tmpDir, 'findings.json'), JSON.stringify(SEED_FINDINGS, null, 2));

  // Clear module cache
  delete require.cache[require.resolve('../../routes/export')];
  const exportRoutes = require('../../routes/export');

  app = express();
  app.use(express.json());
  app.use('/api/export', exportRoutes);
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('POST /api/export/report', () => {
  it('generates markdown report', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.report).toContain('# Security Audit Report');
    expect(res.body.report).toContain('Missing signer check');
  });

  it('includes only specified findingIds', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({ findingIds: ['accounts-access-001'] });
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('Missing signer check');
    expect(res.body.report).not.toContain('Unchecked CPI return');
  });

  it('returns 400 for invalid findingIds format', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({ findingIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('findingIds');
  });

  it('returns 400 for findingIds with invalid ID patterns', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({ findingIds: ['../../etc'] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/export/github-issues', () => {
  it('returns 400 for invalid repo format', async () => {
    const res = await request(app)
      .post('/api/export/github-issues')
      .send({ repo: 'not a valid repo; rm -rf /' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('repo must be');
  });

  it('returns 400 without repo', async () => {
    const res = await request(app)
      .post('/api/export/github-issues')
      .send({});
    expect(res.status).toBe(400);
  });
});
