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
    {
      id: 'math-001',
      agent: 'math-logic',
      title: 'Integer overflow in deposit',
      severity: 'critical',
      confidence: 'high',
      file: 'src/deposit.rs',
      line: 15,
      bugClass: 'integer-overflow',
      description: 'Unchecked addition may overflow',
      proof: 'amount + fee can exceed u64::MAX',
      recommendation: 'Use checked_add',
      status: 'valid',
    },
    {
      id: 'state-001',
      agent: 'state-lifecycle',
      title: 'Minor logging gap',
      severity: 'informational',
      confidence: 'low',
      file: 'src/events.rs',
      line: 5,
      bugClass: 'missing-event',
      description: 'No event emitted on close',
      proof: 'close_account does not emit event',
      recommendation: 'Add CloseEvent emit',
      status: 'dismissed',
    },
  ],
};

const SEED_THREAT_MODEL = {
  executiveSummary: 'This is a test threat model summary.',
  programSummary: {
    name: 'test-program',
    framework: 'anchor',
    totalLoc: 1200,
    instructionCount: 5,
    handlesFunds: true,
    usesOracles: false,
    complexityProfile: 'moderate',
  },
  actors: [
    { label: 'Admin', trustLevel: 'Trusted', description: 'Program deployer', instructions: ['initialize'] },
    { label: 'User', trustLevel: 'Untrusted', description: 'Any wallet holder', instructions: ['deposit', 'withdraw'] },
  ],
  trustBoundaries: [
    { name: 'Signer boundary', riskLevel: 'high', description: 'Validates transaction signer', crossedBy: ['User'] },
  ],
  invariants: [
    { id: 'INV-001', type: 'funds', importance: 'critical', property: 'Total deposits >= total withdrawals', scope: 'vault account' },
    { id: 'INV-002', type: 'access', importance: 'high', property: 'Only admin can initialize', scope: 'initialize instruction' },
  ],
  attackSurfaces: [
    { name: 'Deposit handler', threatLevel: 'high', description: 'Accepts user funds', instructions: ['deposit'], exposureFactors: ['Unbounded input'] },
  ],
  threatCategories: [
    { category: 'integer-overflow', relevance: 'high', summary: 'Arithmetic operations without overflow checks', affectedInstructions: ['deposit'] },
  ],
};

const SEED_AUDIT = {
  repoUrl: 'https://github.com/test/test-program.git',
  localPath: '',
  scopeNotes: '',
};

const SEED_SCOPE = {
  framework: 'anchor',
  files: [
    { path: 'src/lib.rs', loc: 200 },
    { path: 'src/deposit.rs', loc: 150 },
    { path: 'src/transfer.rs', loc: 100 },
  ],
  accepted: true,
};

// Mock generatePdf to avoid needing a real browser
const mockGeneratePdf = vi.fn().mockResolvedValue(Buffer.from('fake-pdf-content'));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-route-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Seed findings
  fs.writeFileSync(path.join(tmpDir, 'findings.json'), JSON.stringify(SEED_FINDINGS, null, 2));

  // Mock the pdf-report module
  const pdfReportPath = require.resolve('../../lib/pdf-report');
  require.cache[pdfReportPath] = {
    id: pdfReportPath,
    filename: pdfReportPath,
    loaded: true,
    exports: { generatePdf: mockGeneratePdf, buildHtml: require('../../lib/pdf-report').buildHtml },
  };

  // Clear module cache
  delete require.cache[require.resolve('../../lib/state-io')];
  delete require.cache[require.resolve('../../routes/export')];
  const exportRoutes = require('../../routes/export');

  app = express();
  app.use(express.json());
  app.use('/api/export', exportRoutes);

  mockGeneratePdf.mockClear();
  mockGeneratePdf.mockResolvedValue(Buffer.from('fake-pdf-content'));
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

// ── Markdown report ──────────────────────────────────────────────────

describe('POST /api/export/report', () => {
  it('generates markdown report with all valid findings', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.report).toContain('# Security Audit Report');
    expect(res.body.report).toContain('Missing signer check');
    expect(res.body.report).toContain('Unchecked CPI return');
    expect(res.body.report).toContain('Integer overflow in deposit');
    // Dismissed finding should not appear
    expect(res.body.report).not.toContain('Minor logging gap');
  });

  it('includes only specified findingIds', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({ findingIds: ['accounts-access-001'] });
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('Missing signer check');
    expect(res.body.report).not.toContain('Unchecked CPI return');
  });

  it('groups findings by severity', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    const report = res.body.report;
    // Critical should appear before High which should appear before Medium
    const critIdx = report.indexOf('Critical');
    const highIdx = report.indexOf('High');
    const medIdx = report.indexOf('Medium');
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(medIdx);
  });

  it('includes severity summary table', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('| Severity | Count |');
  });

  it('includes audit metadata when audit.json exists', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('github.com/test/test-program');
  });

  it('includes threat model when requested and available', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/report')
      .send({ includeThreatModel: true });
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('# Threat Model');
    expect(res.body.report).toContain('test threat model summary');
  });

  it('omits threat model when not requested', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).not.toContain('# Threat Model');
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

  it('includes Daybreak footer', async () => {
    const res = await request(app)
      .post('/api/export/report')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toContain('Daybreak');
  });
});

// ── JSON export ──────────────────────────────────────────────────────

describe('POST /api/export/json', () => {
  it('exports all valid findings when no findingIds specified', async () => {
    const res = await request(app)
      .post('/api/export/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(3);
    expect(res.body.findings.every(f => f.status === 'valid')).toBe(true);
  });

  it('exports only specified findings', async () => {
    const res = await request(app)
      .post('/api/export/json')
      .send({ findingIds: ['math-001'] });
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].id).toBe('math-001');
  });

  it('returns 400 for invalid findingIds', async () => {
    const res = await request(app)
      .post('/api/export/json')
      .send({ findingIds: '../../evil' });
    expect(res.status).toBe(400);
  });
});

// ── Threat model export ──────────────────────────────────────────────

describe('POST /api/export/threat-model', () => {
  it('returns 404 when no threat model exists', async () => {
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not available');
  });

  it('exports threat model as markdown', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.report).toContain('# Threat Model');
    expect(res.body.report).toContain('Executive Summary');
    expect(res.body.report).toContain('test-program');
  });

  it('includes actors section', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.body.report).toContain('## Actors');
    expect(res.body.report).toContain('Admin');
    expect(res.body.report).toContain('Untrusted');
  });

  it('includes trust boundaries', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.body.report).toContain('## Trust Boundaries');
    expect(res.body.report).toContain('Signer boundary');
  });

  it('includes invariants', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.body.report).toContain('## Invariants');
    expect(res.body.report).toContain('Fund Conservation');
    expect(res.body.report).toContain('INV-001');
  });

  it('includes attack surfaces', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.body.report).toContain('## Attack Surfaces');
    expect(res.body.report).toContain('Deposit handler');
  });

  it('includes threat categories', async () => {
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));
    const res = await request(app)
      .post('/api/export/threat-model')
      .send({});
    expect(res.body.report).toContain('## Threat Categories');
    expect(res.body.report).toContain('Integer Overflow');
  });
});

// ── GitHub issues ────────────────────────────────────────────────────

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

  it('returns 400 for repo with special characters', async () => {
    const res = await request(app)
      .post('/api/export/github-issues')
      .send({ repo: 'owner/name$(whoami)' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid findingIds', async () => {
    const res = await request(app)
      .post('/api/export/github-issues')
      .send({ repo: 'owner/repo', findingIds: ['../../etc'] });
    expect(res.status).toBe(400);
  });
});

// ── PDF export ───────────────────────────────────────────────────────

describe('POST /api/export/pdf', () => {
  it('returns PDF binary with correct headers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));
    fs.writeFileSync(path.join(tmpDir, 'scope.json'), JSON.stringify(SEED_SCOPE));

    const res = await request(app)
      .post('/api/export/pdf')
      .send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('daybreak-test-program');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.body).toBeTruthy();
  });

  it('calls generatePdf with correct arguments', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));
    fs.writeFileSync(path.join(tmpDir, 'scope.json'), JSON.stringify(SEED_SCOPE));

    await request(app)
      .post('/api/export/pdf')
      .send({});

    expect(mockGeneratePdf).toHaveBeenCalledTimes(1);
    const args = mockGeneratePdf.mock.calls[0][0];
    expect(args.audit).toEqual(SEED_AUDIT);
    expect(args.findings).toHaveLength(3);
    expect(args.scope).toEqual(SEED_SCOPE);
    expect(args.threatModel).toBeNull();
  });

  it('filters by findingIds', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));

    await request(app)
      .post('/api/export/pdf')
      .send({ findingIds: ['math-001'] });

    const args = mockGeneratePdf.mock.calls[0][0];
    expect(args.findings).toHaveLength(1);
    expect(args.findings[0].id).toBe('math-001');
  });

  it('includes threat model when requested', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));
    fs.writeFileSync(path.join(tmpDir, 'threat-model.json'), JSON.stringify(SEED_THREAT_MODEL));

    await request(app)
      .post('/api/export/pdf')
      .send({ includeThreatModel: true });

    const args = mockGeneratePdf.mock.calls[0][0];
    expect(args.threatModel).toBeDefined();
    expect(args.threatModel.executiveSummary).toContain('test threat model');
  });

  it('returns 400 when no valid findings exist', async () => {
    // Overwrite with only dismissed findings
    fs.writeFileSync(path.join(tmpDir, 'findings.json'), JSON.stringify({
      findings: [SEED_FINDINGS.findings[3]], // only the dismissed one
    }));

    const res = await request(app)
      .post('/api/export/pdf')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No findings');
  });

  it('returns 400 for invalid findingIds', async () => {
    const res = await request(app)
      .post('/api/export/pdf')
      .send({ findingIds: 'not-array' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when generatePdf throws', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify(SEED_AUDIT));
    mockGeneratePdf.mockRejectedValueOnce(new Error('Browser crash'));

    const res = await request(app)
      .post('/api/export/pdf')
      .send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Browser crash');
  });

  it('uses localPath for filename when no repoUrl', async () => {
    fs.writeFileSync(path.join(tmpDir, 'audit.json'), JSON.stringify({
      repoUrl: '',
      localPath: '/home/user/my-program',
    }));

    const res = await request(app)
      .post('/api/export/pdf')
      .send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('daybreak-my-program');
  });
});

// ── buildHtml unit tests ─────────────────────────────────────────────

describe('buildHtml', () => {
  // Load the real module directly for HTML content tests
  const { buildHtml } = require('../../lib/pdf-report');

  const testAudit = SEED_AUDIT;
  const testFindings = SEED_FINDINGS.findings.filter(f => f.status === 'valid');
  const testScope = SEED_SCOPE;

  it('produces valid HTML document', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('loads Google Fonts', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Fraunces');
    expect(html).toContain('JetBrains+Mono');
  });

  it('renders cover with brand and program name', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('class="cover"');
    expect(html).toContain('Daybreak');
    expect(html).toContain('SECURITY');
    expect(html).toContain('test-program');
  });

  it('renders severity bar and pills on cover', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('severity-bar');
    expect(html).toContain('severity-pills');
    expect(html).toContain('sev-pill critical');
    expect(html).toContain('sev-pill high');
    expect(html).toContain('sev-pill medium');
  });

  it('renders cover meta grid', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('cover-meta');
    expect(html).toContain('DATE');
    expect(html).toContain('FRAMEWORK');
    expect(html).toContain('anchor');
    expect(html).toContain('LOC');
    expect(html).toContain('FINDINGS');
  });

  it('renders dawn sun motif CSS', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('radial-gradient');
    expect(html).toContain('rgba(232,90,140');
  });

  it('renders TOC with section entries', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('toc-page');
    expect(html).toContain('toc-list');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Findings');
  });

  it('renders TOC severity groups with finding titles', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('toc-group-label');
    expect(html).toContain('Critical Findings');
    expect(html).toContain('High Findings');
    expect(html).toContain('Integer overflow in deposit');
    expect(html).toContain('Missing signer check');
  });

  it('renders executive summary with stat cards', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('stats-grid');
    expect(html).toContain('CRITICAL + HIGH');
    expect(html).toContain('FILES ANALYZED');
    expect(html).toContain('LOC ANALYZED');
  });

  it('renders severity distribution bars', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('dist-row');
    expect(html).toContain('bar-wrap');
  });

  it('renders findings with severity badges', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('sev-badge');
    expect(html).toContain('#DC2626'); // critical badge bg
    expect(html).toContain('#F08D4A'); // high badge bg
    expect(html).toContain('#E8C26B'); // medium badge bg
  });

  it('renders finding cards with proper structure', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('finding-head');
    expect(html).toContain('finding-title');
    expect(html).toContain('finding-meta');
    expect(html).toContain('finding-section-title');
    expect(html).toContain('DESCRIPTION');
    expect(html).toContain('PROOF');
    expect(html).toContain('RECOMMENDATION');
  });

  it('renders finding meta with gold values', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('meta-val');
    expect(html).toContain('lib.rs:42');
    expect(html).toContain('missing-signer-check');
  });

  it('renders gradient separator between findings', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('border-image: linear-gradient(90deg');
    expect(html).toContain('rgba(232,90,140,0.4)');
  });

  it('renders back page with brand', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('back-page');
    expect(html).toContain('daybreaksec.com');
    expect(html).toContain('gradient-rule');
  });

  it('omits threat model section when null', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).not.toContain('Threat model.');
    expect(html).not.toContain('data-section="THREAT MODEL"');
  });

  it('includes threat model section when provided', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('data-section="THREAT MODEL"');
    expect(html).toContain('Threat model.');
    expect(html).toContain('test threat model summary');
  });

  it('renders threat model program overview table', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('tm-table');
    expect(html).toContain('test-program');
    expect(html).toContain('1200');
  });

  it('renders threat model actors with trust tags', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('trust-tag');
    expect(html).toContain('Admin');
    expect(html).toContain('trust-tag trusted');
    expect(html).toContain('trust-tag untrusted');
  });

  it('renders invariant panels with arrow bullets', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('invariant-group');
    expect(html).toContain('Fund Conservation');
    expect(html).toContain('INV-001');
    // Arrow bullet CSS
    expect(html).toContain('\\2192');
  });

  it('renders attack surfaces', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('Attack surfaces');
    expect(html).toContain('Deposit handler');
    expect(html).toContain('Unbounded input');
  });

  it('renders threat categories', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('Threat categories');
    expect(html).toContain('Integer Overflow');
    expect(html).toContain('high relevance');
  });

  it('adds TOC entry for threat model when included', () => {
    const html = buildHtml(testAudit, testFindings, testScope, SEED_THREAT_MODEL);
    expect(html).toContain('Threat Model');
    // Should have 3 TOC entries (exec summary, threat model, findings)
    const tocMatches = html.match(/class="num">\d{2}<\/span>/g);
    expect(tocMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('escapes HTML in finding content', () => {
    const xssFindings = [{
      id: 'xss-001',
      severity: 'high',
      title: '<script>alert("xss")</script>',
      file: 'src/test.rs',
      line: 1,
      bugClass: 'test',
      description: 'Test <img onerror=alert(1)>',
      proof: 'proof',
      recommendation: 'fix',
      status: 'valid',
    }];
    const html = buildHtml(testAudit, xssFindings, testScope, null);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img onerror');
  });

  it('uses US Letter page size', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('size: letter');
  });

  it('uses correct design token colors', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('#0F1729'); // page bg
    expect(html).toContain('#1A2138'); // panel bg
    expect(html).toContain('#080E1F'); // inset bg
    expect(html).toContain('#F5EFE6'); // text primary
    expect(html).toContain('#B8C0D1'); // text secondary
    expect(html).toContain('#8892AB'); // text tertiary
    expect(html).toContain('#E85A8C'); // dawn magenta
    expect(html).toContain('#ED7F65'); // dawn coral
    expect(html).toContain('#F5A65B'); // dawn amber
    expect(html).toContain('#F5D78E'); // dawn gold
  });

  it('includes eyebrow styling with leading dot', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('.eyebrow');
    expect(html).toContain('\\25CF'); // ● character code
    expect(html).toContain('letter-spacing: 0.12em');
  });

  it('uses short finding IDs in display', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('ACCESS-001'); // accounts-access-001 → ACCESS-001
    expect(html).toContain('CPI-001');    // cpi-token-001 → CPI-001
    expect(html).not.toContain('finding-id">accounts-access-001');
  });

  it('shows filename only in meta (not full path)', () => {
    const deepPathFindings = [{
      id: 'test-001', severity: 'high', title: 'Test',
      file: 'programs/staking/src/instructions/deposit.rs', line: 73,
      bugClass: 'test', description: 'desc', proof: 'proof', recommendation: 'rec',
    }];
    const html = buildHtml(testAudit, deepPathFindings, testScope, null);
    expect(html).toContain('deposit.rs:73');
    expect(html).not.toContain('programs/staking/src/instructions/deposit.rs');
  });

  it('renders callout styling for labeled paragraphs', () => {
    const calloutFindings = [{
      id: 'test-001', severity: 'high', title: 'Test',
      file: 'src/lib.rs', line: 1, bugClass: 'test',
      description: '**Attack:** An attacker could drain the pool.',
      proof: 'proof', recommendation: 'rec',
    }];
    const html = buildHtml(testAudit, calloutFindings, testScope, null);
    expect(html).toContain('class="callout"');
  });

  it('normalizes unicode operators in code blocks', () => {
    const codeFindings = [{
      id: 'test-001', severity: 'high', title: 'Test',
      file: 'src/lib.rs', line: 1, bugClass: 'test',
      description: 'Check `amount \u2265 0` in code:\n\n```rust\nif amount \u2265 0 {\n```',
      proof: 'proof', recommendation: 'rec',
    }];
    const html = buildHtml(testAudit, codeFindings, testScope, null);
    expect(html).not.toContain('\u2265'); // ≥ should be normalized
    expect(html).toContain('&gt;=');      // should be >= (HTML-escaped)
  });

  it('uses line references for code block line numbers', () => {
    const lineRefFindings = [{
      id: 'test-001', severity: 'high', title: 'Test',
      file: 'src/lib.rs', line: 73, bugClass: 'test',
      description: 'Bug at:\n\nLines 73-78:\n```rust\nlet x = 1;\nlet y = 2;\n```',
      proof: 'proof', recommendation: 'rec',
    }];
    const html = buildHtml(testAudit, lineRefFindings, testScope, null);
    expect(html).toContain('data-ln="73"');
    expect(html).toContain('data-ln="74"');
  });

  it('renders back page with disclaimer', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('disclaimer');
    expect(html).toContain('does not constitute');
    expect(html).toContain('colin@daybreaksec.com');
  });

  it('includes callout CSS with border-left styling', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    expect(html).toContain('p.callout');
    expect(html).toContain('border-left: 2pt solid');
  });

  it('removes min-height from code block lines', () => {
    const html = buildHtml(testAudit, testFindings, testScope, null);
    const lnRule = html.match(/\.code-block .body .ln \{[^}]+\}/);
    expect(lnRule).toBeTruthy();
    expect(lnRule[0]).not.toContain('min-height');
  });
});
