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
