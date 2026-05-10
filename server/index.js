const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const stateRoutes = require('./routes/state');
const findingsRoutes = require('./routes/findings');
const exportRoutes = require('./routes/export');
const scanRoutes = require('./routes/scan');
const eventsRoutes = require('./routes/events');
const auditsRoutes = require('./routes/audits');
const { recoverFromCrash, cleanup } = require('./lib/agent-runner');

const app = express();
const PORT = process.env.PORT || 3000;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// Security headers
app.use(helmet());

// Restrict CORS to localhost origins only
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
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
}));

// Rate limiting - generous for polling endpoints, tight for mutations
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', generalLimiter);

const scanLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/scan/start', scanLimiter);

app.use(express.json({ limit: '2mb' }));

// API routes
app.use('/api/state', stateRoutes);
app.use('/api/findings', findingsRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/audits', auditsRoutes);
app.use('/api/scan/events', eventsRoutes);
app.use('/api/scan', scanRoutes);

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Crash recovery: clean up orphaned scans from previous runs
recoverFromCrash();

// Graceful shutdown: kill child processes
process.on('SIGINT', () => {
  console.log('\nShutting down, cleaning up agent processes...');
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

app.listen(PORT, BIND_HOST, () => {
  console.log(`Daybreak Solana server running on http://${BIND_HOST}:${PORT}`);
});

module.exports = app;
