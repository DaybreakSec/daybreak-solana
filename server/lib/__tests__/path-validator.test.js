const fs = require('fs');
const path = require('path');
const os = require('os');
const { validatePath, isValidGitUrl, isValidFindingId } = require('../path-validator');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-test-'));
  fs.mkdirSync(path.join(tmpDir, 'sub', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
  fs.writeFileSync(path.join(tmpDir, 'sub', 'nested.txt'), 'nested');
  fs.writeFileSync(path.join(tmpDir, 'sub', 'deep', 'deep.txt'), 'deep');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validatePath', () => {
  it('allows a valid relative path within rootDir', () => {
    const result = validatePath(tmpDir, 'file.txt');
    expect(result).toBe(path.join(tmpDir, 'file.txt'));
  });

  it('allows nested subdirectory paths', () => {
    const result = validatePath(tmpDir, 'sub/nested.txt');
    expect(result).toBe(path.join(tmpDir, 'sub', 'nested.txt'));
  });

  it('allows deeply nested paths', () => {
    const result = validatePath(tmpDir, 'sub/deep/deep.txt');
    expect(result).toBe(path.join(tmpDir, 'sub', 'deep', 'deep.txt'));
  });

  it('throws on ../ traversal', () => {
    expect(() => validatePath(tmpDir, '../../../etc/passwd')).toThrow('Path escapes root directory');
  });

  it('throws on absolute path escape', () => {
    expect(() => validatePath(tmpDir, '/etc/passwd')).toThrow('Path escapes root directory');
  });

  it('throws on path that resolves outside root', () => {
    expect(() => validatePath(tmpDir, 'sub/../../outside')).toThrow('Path escapes root directory');
  });
});

describe('isValidGitUrl', () => {
  it('accepts valid GitHub HTTPS URL', () => {
    expect(isValidGitUrl('https://github.com/user/repo.git')).toBe(true);
  });

  it('accepts valid GitLab HTTPS URL', () => {
    expect(isValidGitUrl('https://gitlab.com/org/project')).toBe(true);
  });

  it('accepts valid Bitbucket HTTPS URL', () => {
    expect(isValidGitUrl('https://bitbucket.org/user/repo')).toBe(true);
  });

  it('accepts valid Codeberg HTTPS URL', () => {
    expect(isValidGitUrl('https://codeberg.org/user/repo')).toBe(true);
  });

  it('accepts valid sr.ht HTTPS URL', () => {
    expect(isValidGitUrl('https://sr.ht/~user/repo')).toBe(true);
  });

  it('rejects file:// URLs', () => {
    expect(isValidGitUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects ssh:// URLs', () => {
    expect(isValidGitUrl('ssh://git@github.com/user/repo.git')).toBe(false);
  });

  it('rejects git@ URLs', () => {
    expect(isValidGitUrl('git@github.com:user/repo.git')).toBe(false);
  });

  it('rejects URLs with semicolons', () => {
    expect(isValidGitUrl('https://github.com/user/repo; rm -rf /')).toBe(false);
  });

  it('rejects URLs with pipes', () => {
    expect(isValidGitUrl('https://github.com/user/repo | cat /etc/passwd')).toBe(false);
  });

  it('rejects URLs with backticks', () => {
    expect(isValidGitUrl('https://github.com/user/repo`whoami`')).toBe(false);
  });

  it('rejects URLs with $() command substitution', () => {
    expect(isValidGitUrl('https://github.com/user/$(whoami)')).toBe(false);
  });

  it('rejects URLs with &&', () => {
    expect(isValidGitUrl('https://github.com/user/repo && cat /etc/passwd')).toBe(false);
  });

  it('rejects http:// (non-HTTPS)', () => {
    expect(isValidGitUrl('http://github.com/user/repo')).toBe(false);
  });

  it('rejects null input', () => {
    expect(isValidGitUrl(null)).toBe(false);
  });

  it('rejects undefined input', () => {
    expect(isValidGitUrl(undefined)).toBe(false);
  });

  it('rejects number input', () => {
    expect(isValidGitUrl(42)).toBe(false);
  });
});

describe('isValidFindingId', () => {
  it('accepts valid pattern: accounts-access-001', () => {
    expect(isValidFindingId('accounts-access-001')).toBe(true);
  });

  it('accepts valid pattern: cpi-token-042', () => {
    expect(isValidFindingId('cpi-token-042')).toBe(true);
  });

  it('accepts valid pattern: state-lifecycle-999', () => {
    expect(isValidFindingId('state-lifecycle-999')).toBe(true);
  });

  it('rejects traversal strings', () => {
    expect(isValidFindingId('../../etc')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidFindingId('UPPER-001')).toBe(false);
  });

  it('rejects missing digits', () => {
    expect(isValidFindingId('foo-bar')).toBe(false);
  });

  it('rejects too few digits', () => {
    expect(isValidFindingId('foo-bar-01')).toBe(false);
  });

  it('rejects too many digits', () => {
    expect(isValidFindingId('foo-bar-0001')).toBe(false);
  });

  it('rejects null input', () => {
    expect(isValidFindingId(null)).toBe(false);
  });

  it('rejects undefined input', () => {
    expect(isValidFindingId(undefined)).toBe(false);
  });

  it('rejects number input', () => {
    expect(isValidFindingId(123)).toBe(false);
  });
});
