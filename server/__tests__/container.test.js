const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const composefile = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');

describe('Dockerfile', () => {
  const lines = dockerfile.split('\n');

  it('uses multi-stage build with named build stage', () => {
    const buildStage = lines.find(l => /^FROM\s+.+\s+AS\s+build/i.test(l));
    expect(buildStage).toBeDefined();
  });

  it('has a separate runtime stage', () => {
    const fromLines = lines.filter(l => /^FROM\s+/i.test(l));
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
  });

  it('pins base image to a specific version (not :latest or bare tag)', () => {
    const fromLines = lines.filter(l => /^FROM\s+/i.test(l));
    for (const line of fromLines) {
      const image = line.replace(/^FROM\s+/i, '').split(/\s/)[0];
      // Must have a tag with digits (e.g., node:22.16-slim)
      expect(image).toMatch(/:\d/);
      expect(image).not.toMatch(/:latest/);
    }
  });

  it('uses slim base image', () => {
    const fromLines = lines.filter(l => /^FROM\s+/i.test(l));
    for (const line of fromLines) {
      expect(line).toMatch(/slim/i);
    }
  });

  it('creates non-root user', () => {
    const useradd = lines.find(l => /useradd/.test(l));
    expect(useradd).toBeDefined();
    expect(useradd).toContain('daybreak');
  });

  it('switches to non-root USER before CMD', () => {
    const userIdx = lines.findIndex(l => /^USER\s+daybreak/.test(l));
    const cmdIdx = lines.findIndex(l => /^CMD\s+/.test(l));
    expect(userIdx).toBeGreaterThan(-1);
    expect(cmdIdx).toBeGreaterThan(userIdx);
  });

  it('includes HEALTHCHECK directive', () => {
    const healthcheck = lines.find(l => /^HEALTHCHECK\s+/.test(l));
    expect(healthcheck).toBeDefined();
    expect(healthcheck).toMatch(/--interval/);
    expect(healthcheck).toMatch(/--timeout/);
    expect(healthcheck).toMatch(/--start-period/);
    expect(healthcheck).toMatch(/--retries/);
  });

  it('healthcheck targets a real endpoint', () => {
    const cmdLine = lines.find(l => l.includes('fetch(') && l.includes('localhost'));
    expect(cmdLine).toBeDefined();
    expect(cmdLine).toMatch(/\/api\/scan\/status/);
  });

  it('uses COPY --chown instead of chown -R', () => {
    const chownR = lines.find(l => /chown\s+-R/.test(l));
    expect(chownR).toBeUndefined();

    const copyChown = lines.filter(l => /^COPY\s+--from=build\s+--chown=/.test(l));
    expect(copyChown.length).toBeGreaterThan(0);
  });

  it('copies only necessary artifacts to runtime stage (no client source)', () => {
    // After the second FROM, there should be no COPY of entire project
    const fromIndices = lines.reduce((acc, l, i) => {
      if (/^FROM\s+/i.test(l)) acc.push(i);
      return acc;
    }, []);
    const runtimeLines = lines.slice(fromIndices[1]);
    const copySrc = runtimeLines.find(l => /^COPY\s+\.\s+\./.test(l));
    expect(copySrc).toBeUndefined();
  });

  it('installs production-only deps in runtime (--omit=dev)', () => {
    const fromIndices = lines.reduce((acc, l, i) => {
      if (/^FROM\s+/i.test(l)) acc.push(i);
      return acc;
    }, []);
    const runtimeLines = lines.slice(fromIndices[1]);
    const npmCi = runtimeLines.find(l => /npm ci/.test(l));
    expect(npmCi).toBeDefined();
    expect(npmCi).toMatch(/--omit=dev/);
  });

  it('sets NODE_ENV=production', () => {
    const envLine = lines.find(l => /^ENV\s+NODE_ENV=production/.test(l));
    expect(envLine).toBeDefined();
  });

  it('exposes correct port', () => {
    const expose = lines.find(l => /^EXPOSE\s+3000/.test(l));
    expect(expose).toBeDefined();
  });

  it('cleans apt lists after install', () => {
    const aptInstalls = lines.filter(l => /apt-get install/.test(l));
    for (const line of aptInstalls) {
      // The rm might be on the same line or a continuation line
      const idx = lines.indexOf(line);
      const block = lines.slice(idx, idx + 4).join(' ');
      expect(block).toMatch(/rm\s+-rf\s+\/var\/lib\/apt\/lists/);
    }
  });

  it('uses --no-install-recommends for apt', () => {
    const aptInstalls = lines.filter(l => /apt-get install/.test(l));
    for (const line of aptInstalls) {
      expect(line).toContain('--no-install-recommends');
    }
  });

  it('installs required runtime tools (python3, git, ast-grep, claude-code)', () => {
    const fromIndices = lines.reduce((acc, l, i) => {
      if (/^FROM\s+/i.test(l)) acc.push(i);
      return acc;
    }, []);
    const runtimeBlock = lines.slice(fromIndices[1]).join('\n');
    expect(runtimeBlock).toMatch(/python3/);
    expect(runtimeBlock).toMatch(/git/);
    expect(runtimeBlock).toMatch(/@ast-grep\/cli/);
    expect(runtimeBlock).toMatch(/@anthropic-ai\/claude-code/);
  });

  it('copies client/dist (built output) not client/src', () => {
    const fromIndices = lines.reduce((acc, l, i) => {
      if (/^FROM\s+/i.test(l)) acc.push(i);
      return acc;
    }, []);
    const runtimeLines = lines.slice(fromIndices[1]);
    const clientDist = runtimeLines.find(l => /client\/dist/.test(l));
    const clientSrc = runtimeLines.find(l => /client\/src/.test(l));
    expect(clientDist).toBeDefined();
    expect(clientSrc).toBeUndefined();
  });
});

describe('docker-compose.yml', () => {
  const composeLines = composefile.split('\n');

  it('does not use deprecated mem_limit', () => {
    const memLimit = composeLines.find(l => /^\s+mem_limit:/.test(l));
    expect(memLimit).toBeUndefined();
  });

  it('does not use deprecated cpus top-level key', () => {
    // cpus as a top-level service key (not under deploy.resources) is deprecated
    const cpusLine = composeLines.find(l => /^\s{4}cpus:/.test(l));
    expect(cpusLine).toBeUndefined();
  });

  it('uses deploy.resources.limits for resource constraints', () => {
    expect(composefile).toContain('deploy:');
    expect(composefile).toContain('resources:');
    expect(composefile).toContain('limits:');
  });

  it('sets memory limit under deploy.resources.limits', () => {
    const memLine = composeLines.find(l => /memory:\s+/.test(l));
    expect(memLine).toBeDefined();
    expect(memLine).toMatch(/4g/);
  });

  it('sets cpu limit under deploy.resources.limits', () => {
    const cpuLine = composeLines.find(l => /cpus:\s+/.test(l));
    expect(cpuLine).toBeDefined();
    // Must be indented under limits (at least 8+ spaces of indentation)
    expect(cpuLine).toMatch(/^\s{8,}cpus:/);
  });

  it('binds to localhost only', () => {
    const portLine = composeLines.find(l => /ports:/.test(l));
    expect(portLine).toBeDefined();
    const portMapping = composeLines.find(l => /127\.0\.0\.1:3000:3000/.test(l));
    expect(portMapping).toBeDefined();
  });

  it('enables no-new-privileges security opt', () => {
    expect(composefile).toContain('no-new-privileges:true');
  });

  it('uses read-only root filesystem', () => {
    const readOnly = composeLines.find(l => /read_only:\s*true/.test(l));
    expect(readOnly).toBeDefined();
  });

  it('mounts tmpfs for temporary files', () => {
    expect(composefile).toContain('tmpfs:');
    expect(composefile).toMatch(/\/tmp/);
  });

  it('uses init: true for proper signal handling', () => {
    const initLine = composeLines.find(l => /init:\s*true/.test(l));
    expect(initLine).toBeDefined();
  });

  it('limits log file size', () => {
    expect(composefile).toContain('max-size:');
    expect(composefile).toContain('max-file:');
  });

  it('uses restart policy', () => {
    const restartLine = composeLines.find(l => /restart:/.test(l));
    expect(restartLine).toBeDefined();
    expect(restartLine).toMatch(/unless-stopped/);
  });

  it('persists claude auth as named volume', () => {
    expect(composefile).toContain('claude-auth:');
    expect(composefile).toMatch(/claude-auth:\/home\/daybreak\/.claude/);
  });
});
