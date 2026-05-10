const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
let stateIo;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sio-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;
  // Re-require to pick up new env
  delete require.cache[require.resolve('../state-io')];
  stateIo = require('../state-io');
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('readJSON / writeJSON', () => {
  it('write then read returns same data', () => {
    const data = { foo: 'bar', nested: { a: 1 } };
    stateIo.writeJSON('test.json', data);
    const result = stateIo.readJSON('test.json');
    expect(result).toEqual(data);
  });

  it('read nonexistent file returns null', () => {
    const result = stateIo.readJSON('nonexistent.json');
    expect(result).toBeNull();
  });

  it('atomic write produces valid JSON (tmp + rename)', () => {
    const data = { large: 'x'.repeat(10000) };
    stateIo.writeJSON('atomic.json', data);
    // Verify the tmp file doesn't linger
    expect(fs.existsSync(path.join(tmpDir, 'atomic.json.tmp'))).toBe(false);
    // Verify the file is valid JSON
    const raw = fs.readFileSync(path.join(tmpDir, 'atomic.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(data);
  });
});

describe('readFindings / writeFindings', () => {
  it('returns { findings: [] } when no file exists', () => {
    const result = stateIo.readFindings();
    expect(result).toEqual({ findings: [] });
  });

  it('roundtrips data correctly', () => {
    const data = {
      findings: [
        { id: 'test-001', title: 'Test Finding', severity: 'high' },
      ],
    };
    stateIo.writeFindings(data);
    const result = stateIo.readFindings();
    expect(result).toEqual(data);
  });
});

describe('withLock', () => {
  it('sequential execution: two concurrent writers produce correct final state', async () => {
    stateIo.writeJSON('counter.json', { count: 0 });

    const writer = async (increment) => {
      return stateIo.withLock(() => {
        const data = stateIo.readJSON('counter.json');
        data.count += increment;
        stateIo.writeJSON('counter.json', data);
        return data.count;
      });
    };

    // Run two writes concurrently; lock should serialize them
    const [r1, r2] = await Promise.all([writer(1), writer(2)]);

    const final = stateIo.readJSON('counter.json');
    expect(final.count).toBe(3);
    // One should see 1 or 2, the other should see 3
    expect([r1, r2].sort()).toEqual([1, 3]);
  });

  it('deadlock guard: second call throws after timeout instead of corrupting', async () => {
    // First lock that never resolves naturally
    const neverResolve = stateIo.withLock(() => {
      return new Promise(() => {}); // never resolves
    });

    // Second lock should reject after ~10s timeout (not silently proceed)
    const start = Date.now();
    await expect(stateIo.withLock(() => 'completed'))
      .rejects.toThrow('lock held longer than 10s');

    const elapsed = Date.now() - start;
    // Should have waited roughly 10s (tolerance: 8-15s)
    expect(elapsed).toBeGreaterThanOrEqual(8000);
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
});
