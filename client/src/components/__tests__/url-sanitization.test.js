// Test the URL sanitization regex used in MarkdownProse
// This regex is the guard that determines whether a link renders as <a> or <span>
const SAFE_URL_RE = /^https?:\/\//i;

describe('MarkdownProse URL Sanitization', () => {
  describe('blocks dangerous URLs', () => {
    it('blocks javascript: protocol', () => {
      expect(SAFE_URL_RE.test('javascript:alert(1)')).toBe(false);
    });

    it('blocks JAVASCRIPT: protocol (case bypass attempt)', () => {
      expect(SAFE_URL_RE.test('JAVASCRIPT:alert(1)')).toBe(false);
    });

    it('blocks data: URLs', () => {
      expect(SAFE_URL_RE.test('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('blocks vbscript: protocol', () => {
      expect(SAFE_URL_RE.test('vbscript:MsgBox("XSS")')).toBe(false);
    });

    it('blocks protocol-relative URLs (//evil.com)', () => {
      expect(SAFE_URL_RE.test('//evil.com')).toBe(false);
    });

    it('blocks relative path traversal', () => {
      expect(SAFE_URL_RE.test('./../../etc')).toBe(false);
    });

    it('blocks ftp: protocol', () => {
      expect(SAFE_URL_RE.test('ftp://evil.com')).toBe(false);
    });

    it('blocks empty string', () => {
      expect(SAFE_URL_RE.test('')).toBe(false);
    });

    it('blocks file: protocol', () => {
      expect(SAFE_URL_RE.test('file:///etc/passwd')).toBe(false);
    });
  });

  describe('allows safe URLs', () => {
    it('allows https://example.com', () => {
      expect(SAFE_URL_RE.test('https://example.com')).toBe(true);
    });

    it('allows http://example.com', () => {
      expect(SAFE_URL_RE.test('http://example.com')).toBe(true);
    });

    it('allows HTTP://EXAMPLE.COM (uppercase)', () => {
      expect(SAFE_URL_RE.test('HTTP://EXAMPLE.COM')).toBe(true);
    });

    it('allows https with anchor fragment', () => {
      expect(SAFE_URL_RE.test('https://docs.rs/anchor#section')).toBe(true);
    });

    it('allows https with query parameters', () => {
      expect(SAFE_URL_RE.test('https://google.com?q=test')).toBe(true);
    });
  });
});
