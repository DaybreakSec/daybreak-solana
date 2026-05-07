const express = require('express');
const path = require('path');
const cors = require('cors');
const stateRoutes = require('./routes/state');
const findingsRoutes = require('./routes/findings');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/state', stateRoutes);
app.use('/api/findings', findingsRoutes);
app.use('/api/export', exportRoutes);

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Daybreak Solana server running on http://localhost:${PORT}`);
});

module.exports = app;
