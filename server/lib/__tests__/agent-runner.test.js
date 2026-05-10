const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-test-'));
  process.env.AUDIT_STATE_DIR = path.join(tmpDir, 'state');
  fs.mkdirSync(process.env.AUDIT_STATE_DIR, { recursive: true });
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

// Import after env setup
const { resolveTargetDir, isRealFinding, normalizeFilePath } = require('../agent-runner');

describe('resolveTargetDir', () => {
  it('returns resolved path for valid local directory', () => {
    const projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir);
    const result = resolveTargetDir({ localPath: projectDir });
    expect(result).toBe(fs.realpathSync(projectDir));
  });

  it('throws on /etc system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/etc' }))
      .toThrow('system directory');
  });

  it('throws on /var system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/var' }))
      .toThrow('system directory');
  });

  it('throws on /proc system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/proc' }))
      .toThrow('system directory');
  });

  it('throws on /sys system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/sys' }))
      .toThrow('system directory');
  });

  it('throws on /dev system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/dev' }))
      .toThrow('system directory');
  });

  it('throws on /root system directory', () => {
    expect(() => resolveTargetDir({ localPath: '/root' }))
      .toThrow('system directory');
  });

  it('throws on non-existent paths', () => {
    expect(() => resolveTargetDir({ localPath: '/nonexistent/path/xyz' }))
      .toThrow('does not exist');
  });

  it('throws on file (not directory) paths', () => {
    const filePath = path.join(tmpDir, 'afile.txt');
    fs.writeFileSync(filePath, 'content');
    expect(() => resolveTargetDir({ localPath: filePath }))
      .toThrow('not a directory');
  });

  it('throws on invalid git URLs (shell injection payloads)', () => {
    expect(() => resolveTargetDir({
      mode: 'git',
      repoUrl: 'https://github.com/user/repo; rm -rf /',
    })).toThrow('Invalid git URL');
  });

  it('throws on file:// git URLs', () => {
    expect(() => resolveTargetDir({
      mode: 'git',
      repoUrl: 'file:///etc/passwd',
    })).toThrow('Invalid git URL');
  });

  it('throws on ssh:// git URLs', () => {
    expect(() => resolveTargetDir({
      mode: 'git',
      repoUrl: 'ssh://git@github.com/user/repo.git',
    })).toThrow('Invalid git URL');
  });

  it('throws when no target path configured', () => {
    expect(() => resolveTargetDir({}))
      .toThrow('No target path configured');
  });
});

describe('isRealFinding', () => {
  it('returns true for normal findings', () => {
    expect(isRealFinding({ title: 'Missing owner check', severity: 'high' })).toBe(true);
  });

  it('returns false for titles starting with "lead:"', () => {
    expect(isRealFinding({ title: 'lead: potential overflow' })).toBe(false);
  });

  it('returns false for titles starting with "lead -"', () => {
    expect(isRealFinding({ title: 'lead - possible reentrancy' })).toBe(false);
  });

  it('returns false for "prescan false positive"', () => {
    expect(isRealFinding({ title: 'Prescan false positive: overflow check exists' })).toBe(false);
  });

  it('returns false for informational false positives', () => {
    expect(isRealFinding({
      title: 'False positive: checked arithmetic used throughout',
      severity: 'informational',
    })).toBe(false);
  });

  it('returns true for non-informational with "false positive" in title', () => {
    // Only informational false positives are filtered
    expect(isRealFinding({
      title: 'False positive detection bypass',
      severity: 'high',
    })).toBe(true);
  });
});

describe('normalizeFilePath', () => {
  it('strips targetDir prefix', () => {
    expect(normalizeFilePath('/home/user/project/src/lib.rs', '/home/user/project'))
      .toBe('src/lib.rs');
  });

  it('handles trailing slash on targetDir', () => {
    expect(normalizeFilePath('/home/user/project/src/lib.rs', '/home/user/project/'))
      .toBe('src/lib.rs');
  });

  it('returns original path when no prefix match', () => {
    expect(normalizeFilePath('src/lib.rs', '/other/dir'))
      .toBe('src/lib.rs');
  });

  it('handles null/undefined filePath', () => {
    expect(normalizeFilePath(null, '/dir')).toBe('');
    expect(normalizeFilePath(undefined, '/dir')).toBe('');
  });

  it('handles null/undefined targetDir', () => {
    expect(normalizeFilePath('/path/file.rs', null)).toBe('/path/file.rs');
  });
});

// Additional imports for newly-tested exports
const { getActiveScan, cancelScan, recoverFromCrash, cleanup, AGENT_KEYS } = require('../agent-runner');
const { writeScan, writeProgress, readProgress, readScan } = require('../state-io');

describe('AGENT_KEYS', () => {
  it('is an array of strings', () => {
    expect(Array.isArray(AGENT_KEYS)).toBe(true);
    expect(AGENT_KEYS.length).toBeGreaterThan(0);
    for (const key of AGENT_KEYS) {
      expect(typeof key).toBe('string');
    }
  });

  it('contains the expected five agent keys', () => {
    expect(AGENT_KEYS).toContain('accounts-access');
    expect(AGENT_KEYS).toContain('cpi-token');
    expect(AGENT_KEYS).toContain('arithmetic-economic');
    expect(AGENT_KEYS).toContain('state-lifecycle');
    expect(AGENT_KEYS).toContain('invariant-logic');
  });

  it('has exactly 5 agents', () => {
    expect(AGENT_KEYS).toHaveLength(5);
  });
});

describe('getActiveScan', () => {
  it('returns null when no scan is active', () => {
    expect(getActiveScan()).toBeNull();
  });
});

describe('cancelScan', () => {
  it('returns false when no scan is active', () => {
    expect(cancelScan()).toBe(false);
  });

  it('does not throw when called with no active scan', () => {
    expect(() => cancelScan()).not.toThrow();
  });
});

describe('recoverFromCrash', () => {
  it('does nothing when scan.json does not exist', () => {
    // No scan.json in state dir - should be a no-op
    expect(() => recoverFromCrash()).not.toThrow();
    // Progress should remain unchanged (empty object)
    const progress = readProgress();
    expect(progress.phase).toBeUndefined();
  });

  it('does nothing when scan.json has running:false', () => {
    writeScan({ running: false, finishedAt: '2025-01-01T00:00:00Z' });
    expect(() => recoverFromCrash()).not.toThrow();
    // Progress should remain unchanged
    const progress = readProgress();
    expect(progress.phase).toBeUndefined();
  });

  it('recovers orphaned scan state when scan.json has running:true', () => {
    // Set up orphaned scan state
    writeScan({ running: true, startedAt: '2025-01-01T00:00:00Z', pids: [] });
    writeProgress({
      phase: 'scanning',
      agents: {
        'accounts-access': { status: 'scanning' },
        'cpi-token': { status: 'queued' },
        'arithmetic-economic': { status: 'complete' },
      },
    });

    recoverFromCrash();

    // Verify scan.json is now marked not running
    const scan = readScan();
    expect(scan.running).toBe(false);
    expect(scan.recoveredAt).toBeDefined();

    // Verify progress reflects error state
    const progress = readProgress();
    expect(progress.phase).toBe('error');
    expect(progress.error).toBe('Server restarted during scan');

    // scanning/queued agents should be marked as error
    expect(progress.agents['accounts-access'].status).toBe('error');
    expect(progress.agents['accounts-access'].error).toBe('Server restarted during scan');
    expect(progress.agents['cpi-token'].status).toBe('error');
    expect(progress.agents['cpi-token'].error).toBe('Server restarted during scan');

    // completed agent should remain complete
    expect(progress.agents['arithmetic-economic'].status).toBe('complete');
  });

  it('handles scan.json with running:true and stale PIDs gracefully', () => {
    // PIDs that don't exist - process.kill should not throw because
    // the module wraps it in try/catch
    writeScan({ running: true, startedAt: '2025-01-01T00:00:00Z', pids: [999999, 999998] });
    writeProgress({ phase: 'scanning', agents: {} });

    expect(() => recoverFromCrash()).not.toThrow();

    const scan = readScan();
    expect(scan.running).toBe(false);
  });
});

describe('cleanup', () => {
  it('does nothing when no scan is active', () => {
    // activeScan is null after module load or cancelScan
    expect(() => cleanup()).not.toThrow();
  });

  it('does not throw and does not alter state when activeScan is null', () => {
    // Ensure there is some existing scan.json
    writeScan({ running: true, startedAt: '2025-01-01T00:00:00Z' });

    cleanup();

    // Since activeScan is null, cleanup is a no-op and scan.json should be unchanged
    const scan = readScan();
    expect(scan.running).toBe(true);
  });
});

describe('isValidFindingShape (tested indirectly via module logic)', () => {
  // Since isValidFindingShape is not exported, we test the same validation logic
  // by extracting and evaluating it from the module source.
  const vm = require('vm');
  const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'agent-runner.js'), 'utf8');

  // Extract the function and its dependencies
  const fnSrc = `
    const REQUIRED_FINDING_FIELDS = ['title', 'severity', 'file', 'bugClass', 'description', 'proof'];
    const VALID_SEVERITIES_SET = new Set(['critical', 'high', 'medium', 'low', 'informational']);
    ${moduleSrc.match(/function isValidFindingShape\(f\) \{[\s\S]*?\n\}/)[0]}
    isValidFindingShape;
  `;
  const isValidFindingShape = vm.runInNewContext(fnSrc);

  it('returns null for a valid finding with all required fields', () => {
    const valid = {
      title: 'Missing owner check',
      severity: 'high',
      file: 'programs/vault/src/lib.rs',
      bugClass: 'access-control',
      description: 'The instruction does not verify the owner.',
      proof: 'Line 42 shows no owner constraint.',
    };
    expect(isValidFindingShape(valid)).toBeNull();
  });

  it('returns null for all valid severities', () => {
    const base = {
      title: 'Issue',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    for (const sev of ['critical', 'high', 'medium', 'low', 'informational']) {
      expect(isValidFindingShape({ ...base, severity: sev })).toBeNull();
    }
  });

  it('rejects null input', () => {
    expect(isValidFindingShape(null)).toBe('finding is not an object');
  });

  it('rejects non-object input', () => {
    expect(isValidFindingShape('string')).toBe('finding is not an object');
    expect(isValidFindingShape(42)).toBe('finding is not an object');
    expect(isValidFindingShape(undefined)).toBe('finding is not an object');
  });

  it('rejects finding missing title', () => {
    const f = {
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: title');
  });

  it('rejects finding missing severity', () => {
    const f = {
      title: 'Issue',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: severity');
  });

  it('rejects finding missing file', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: file');
  });

  it('rejects finding missing bugClass', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      file: 'src/lib.rs',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: bugClass');
  });

  it('rejects finding missing description', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: description');
  });

  it('rejects finding missing proof', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: proof');
  });

  it('rejects finding with empty string field', () => {
    const f = {
      title: '',
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: title');
  });

  it('rejects finding with non-string field value', () => {
    const f = {
      title: 123,
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('missing or invalid field: title');
  });

  it('rejects invalid severity value', () => {
    const f = {
      title: 'Issue',
      severity: 'ultra-critical',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBe('invalid severity: ultra-critical');
  });

  it('rejects when line is present but not a number', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
      line: '42',
    };
    expect(isValidFindingShape(f)).toBe('line must be a number');
  });

  it('accepts finding with valid numeric line', () => {
    const f = {
      title: 'Issue',
      severity: 'high',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
      line: 42,
    };
    expect(isValidFindingShape(f)).toBeNull();
  });

  it('accepts finding without line field (line is optional)', () => {
    const f = {
      title: 'Issue',
      severity: 'medium',
      file: 'src/lib.rs',
      bugClass: 'logic',
      description: 'Desc',
      proof: 'Proof',
    };
    expect(isValidFindingShape(f)).toBeNull();
  });
});
