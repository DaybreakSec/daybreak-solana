const fs = require('fs');
const path = require('path');
const os = require('os');
const { readSourceFiles, estimateTokens, detectLang } = require('../source-reader');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
  fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'fn main() {\n    println!("hello");\n}\n');
  fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"key": "value"}\n');
  fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'Just a readme\n');
  // Create a large file to test budget limits
  fs.writeFileSync(path.join(tmpDir, 'huge.rs'), 'x'.repeat(600001)); // > 150K tokens
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectLang', () => {
  it('maps .rs to rust', () => {
    expect(detectLang('program/src/lib.rs')).toBe('rust');
  });

  it('maps .ts to typescript', () => {
    expect(detectLang('src/index.ts')).toBe('typescript');
  });

  it('maps .js to javascript', () => {
    expect(detectLang('server/index.js')).toBe('javascript');
  });

  it('returns empty string for unknown extension', () => {
    expect(detectLang('file.xyz')).toBe('');
  });
});

describe('estimateTokens', () => {
  it('returns Math.ceil(text.length / 4)', () => {
    expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 4)); // 3
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('readSourceFiles', () => {
  it('reads and formats files from a directory', () => {
    const files = [
      { path: 'lib.rs', loc: 3 },
      { path: 'utils.ts', loc: 1 },
    ];
    const result = readSourceFiles(tmpDir, files);
    expect(result.includedFiles).toContain('lib.rs');
    expect(result.includedFiles).toContain('utils.ts');
    expect(result.formatted).toContain('<source-file path="lib.rs">');
    expect(result.formatted).toContain('<source-file path="utils.ts">');
    expect(result.formatted).toContain('</source-file>');
    expect(result.totalLoc).toBeGreaterThan(0);
    expect(result.warning).toBeNull();
  });

  it('respects token budget (excludes files over limit)', () => {
    const files = [
      { path: 'huge.rs', loc: 1 },
      { path: 'lib.rs', loc: 3 },
    ];
    const result = readSourceFiles(tmpDir, files);
    // huge.rs is 600001 chars = 150001 tokens, exceeds 150K budget
    expect(result.excludedByBudget).toContain('huge.rs');
    expect(result.includedFiles).toContain('lib.rs');
    expect(result.warning).toContain('excluded');
  });

  it('excludes files in the excludedFiles list', () => {
    const files = [
      { path: 'lib.rs', loc: 3 },
      { path: 'utils.ts', loc: 1 },
    ];
    const result = readSourceFiles(tmpDir, files, ['utils.ts']);
    expect(result.includedFiles).toContain('lib.rs');
    expect(result.includedFiles).not.toContain('utils.ts');
  });

  it('boosts priority for keyword-matching files', () => {
    const files = [
      { path: 'config.json', loc: 1 },
      { path: 'lib.rs', loc: 3 },
    ];
    // Boost files matching 'lib'
    const result = readSourceFiles(tmpDir, files, [], ['lib']);
    // lib.rs should come first due to keyword boost
    expect(result.includedFiles[0]).toBe('lib.rs');
  });

  it('throws on files with path traversal (validatePath rejects before read)', () => {
    const files = [
      { path: '../../../etc/passwd', loc: 1 },
      { path: 'lib.rs', loc: 3 },
    ];
    // validatePath is called outside the try/catch, so traversal causes a throw
    expect(() => readSourceFiles(tmpDir, files)).toThrow('Path escapes root directory');
  });

  describe('excludedByError tracking', () => {
    it('populates excludedByError for unreadable files', () => {
      // Create a file and make it unreadable
      const unreadable = path.join(tmpDir, 'noperm.rs');
      fs.writeFileSync(unreadable, 'fn secret() {}');
      fs.chmodSync(unreadable, 0o000);

      const files = [
        { path: 'noperm.rs', loc: 1 },
        { path: 'lib.rs', loc: 3 },
      ];
      const result = readSourceFiles(tmpDir, files);

      expect(result.excludedByError.length).toBeGreaterThan(0);
      expect(result.excludedByError[0]).toHaveProperty('path', 'noperm.rs');
      expect(result.excludedByError[0]).toHaveProperty('reason');
      expect(result.warning).toContain('unreadable');
      expect(result.includedFiles).toContain('lib.rs');

      // Cleanup: restore permissions so afterAll can remove the temp dir
      fs.chmodSync(unreadable, 0o644);
    });

    it('populates excludedByError for non-existent files after validatePath', () => {
      // File does not exist but path is valid (no traversal)
      const files = [
        { path: 'does-not-exist.rs', loc: 1 },
        { path: 'lib.rs', loc: 3 },
      ];
      const result = readSourceFiles(tmpDir, files);

      expect(result.excludedByError.length).toBe(1);
      expect(result.excludedByError[0].path).toBe('does-not-exist.rs');
      expect(result.excludedByError[0].reason).toMatch(/ENOENT|no such file/i);
      expect(result.includedFiles).toContain('lib.rs');
    });
  });

  describe('combined warning messages', () => {
    it('includes both budget and error messages when both occur', () => {
      // huge.rs will exceed budget, non-existent file triggers error
      const files = [
        { path: 'huge.rs', loc: 1 },
        { path: 'does-not-exist.rs', loc: 1 },
        { path: 'lib.rs', loc: 3 },
      ];
      const result = readSourceFiles(tmpDir, files);

      // Should have budget exclusion for huge.rs
      expect(result.excludedByBudget).toContain('huge.rs');
      // Should have error exclusion for non-existent file
      expect(result.excludedByError.length).toBe(1);
      // Warning should contain both messages
      expect(result.warning).toContain('excluded by budget');
      expect(result.warning).toContain('unreadable');
    });

    it('warning only mentions errors when no budget overflow', () => {
      // Small files only, one non-existent
      const files = [
        { path: 'lib.rs', loc: 3 },
        { path: 'ghost-file.rs', loc: 1 },
      ];
      const result = readSourceFiles(tmpDir, files);

      expect(result.excludedByBudget).toHaveLength(0);
      expect(result.excludedByError.length).toBe(1);
      expect(result.warning).toContain('unreadable');
      expect(result.warning).not.toContain('budget');
    });
  });
});
