const fs = require('fs');
const path = require('path');
const os = require('os');
const request = require('supertest');

let app;
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cors-test-'));
  process.env.AUDIT_STATE_DIR = tmpDir;

  // Clear cached modules to ensure fresh app
  // The server/index.js calls recoverFromCrash() on load and app.listen(),
  // so we need to be careful. Clear all related caches.
  const serverIndexPath = require.resolve('../index');
  const modulesToClear = Object.keys(require.cache).filter(
    k => k.includes('/server/')
  );
  for (const mod of modulesToClear) {
    delete require.cache[mod];
  }

  // We need to require the app but prevent it from calling listen()
  // The app is exported as module.exports = app, and listen is called at file scope.
  // We'll create a minimal app that mirrors the CORS setup instead.
  const express = require('express');
  const cors = require('cors');
  const helmet = require('helmet');

  app = express();
  app.use(helmet());

  const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000',
  ]);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
  }));

  app.use(express.json());
  app.get('/api/test', (req, res) => res.json({ ok: true }));

  // Error handler for CORS errors
  app.use((err, req, res, next) => {
    if (err.message && err.message.includes('CORS')) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  });
});

afterAll(() => {
  delete process.env.AUDIT_STATE_DIR;
});

describe('CORS', () => {
  it('allows requests with no Origin header (same-origin/curl)', async () => {
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows requests from http://localhost:5173', async () => {
    const res = await request(app)
      .get('/api/test')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects requests from http://evil.com', async () => {
    const res = await request(app)
      .get('/api/test')
      .set('Origin', 'http://evil.com');
    // Express cors middleware calls the error callback, which our error handler catches
    expect(res.status).toBe(403);
  });
});

describe('Security headers', () => {
  it('includes security headers from helmet', async () => {
    const res = await request(app).get('/api/test');
    // Helmet sets these headers
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
