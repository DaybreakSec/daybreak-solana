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
      status: 'pending',
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
      status: 'pending',
    },
  ],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Seed findings
  fs.writeFileSync(path.join(tmpDir, 'findings.json'), JSON.stringify(SEED_FINDINGS, null, 2));

  // Clear module cache
  delete require.cache[require.resolve('../../lib/state-io')];
  delete require.cache[require.resolve('../../routes/findings')];
  const findingsRoutes = require('../../routes/findings');

  app = express();
  app.use(express.json());
  app.use('/api/findings', findingsRoutes);
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('GET /api/findings', () => {
  it('returns all findings', async () => {
    const res = await request(app).get('/api/findings');
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('filters by severity', async () => {
    const res = await request(app).get('/api/findings?severity=high');
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].severity).toBe('high');
  });
});

describe('PUT /api/findings/:id', () => {
  it('updates status successfully', async () => {
    const res = await request(app)
      .put('/api/findings/accounts-access-001')
      .send({ status: 'valid' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('valid');
    expect(res.body.triagedAt).toBeDefined();
  });

  it('returns 400 for traversal-like ID', async () => {
    // Note: ../../etc in URL path gets normalized by Express before reaching handler.
    // Use URL-encoded dots to test the ID validation directly.
    const res = await request(app)
      .put('/api/findings/..%2F..%2Fetc')
      .send({ status: 'valid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid finding ID');
  });

  it('returns 400 for uppercase ID', async () => {
    const res = await request(app)
      .put('/api/findings/UPPER-001')
      .send({ status: 'valid' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status enum', async () => {
    const res = await request(app)
      .put('/api/findings/accounts-access-001')
      .send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid status');
  });

  it('returns 404 for nonexistent finding', async () => {
    const res = await request(app)
      .put('/api/findings/nonexistent-999')
      .send({ status: 'valid' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});
