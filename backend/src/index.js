'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const http    = require('http');

const { initWebSocket } = require('./ws/server');
const authRouter        = require('./routes/auth');
const fleetRouter       = require('./routes/fleet');
const driverRouter      = require('./routes/driver');
const passengerRouter   = require('./routes/passenger');
const catalogRouter     = require('./routes/catalog');
const networkRouter     = require('./routes/network');
const trackingRouter    = require('./routes/tracking');
const operationsRouter  = require('./routes/operations');
const adminRouter       = require('./routes/admin');
const dashboardRouter   = require('./routes/dashboard');
const ingestRouter      = require('./routes/ingest');
const peopleRouter      = require('./routes/people');
const guardianRouter    = require('./routes/guardian');
const guardiansRouter   = require('./routes/guardians');
const { startAssetJobs } = require('./lib/alerts');
const { requireFeature } = require('./lib/trackingType');
const { errorHandler }  = require('./middleware/error');

const app    = express();
const server = http.createServer(app);

// ─── Global Middleware ───────────────────────────────────────────────
app.set('trust proxy', 1); // behind one tunnel/proxy hop: req.ip is the client, not the proxy
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'FleetSync API', version: '1.0.0' }));

// ─── API Routes ──────────────────────────────────────────────────────
app.use('/api/v1',          authRouter);
// Feature gate: people tenants get no fleet APIs and vehicle tenants get no people APIs.
app.use('/api/v1/fleet',    requireFeature('by-path'));
app.use('/api/v1/driver',   requireFeature('fleet'));
app.use('/api/v1/passenger', requireFeature('fleet'));
app.use('/api/v1/guardian', requireFeature('people'));
app.use('/api/v1/fleet',    fleetRouter);
app.use('/api/v1/fleet',    catalogRouter);
app.use('/api/v1/fleet',    networkRouter);
app.use('/api/v1/fleet',    trackingRouter);
app.use('/api/v1/fleet',    operationsRouter);
app.use('/api/v1/fleet',    adminRouter);
app.use('/api/v1/fleet',    dashboardRouter);
app.use('/api/v1/fleet',    peopleRouter);
app.use('/api/v1/fleet',    guardiansRouter);
app.use('/api/v1/guardian', guardianRouter);
app.use('/api/v1/ingest',   ingestRouter);
app.use('/api/v1/driver',   driverRouter);
app.use('/api/v1/passenger', passengerRouter);

// ─── Static Frontend ─────────────────────────────────────────────────
const path = require('path');
const websiteDir = path.join(__dirname, '../../website');
app.get('/', (_req, res) => res.sendFile(path.join(websiteDir, 'landing.html')));
app.use(express.static(websiteDir));

app.get('/authority', (_req, res) => res.sendFile(path.join(websiteDir, 'authority/index.html')));
app.get('/driver',    (_req, res) => res.sendFile(path.join(websiteDir, 'driver/index.html')));
app.get('/passenger', (_req, res) => res.sendFile(path.join(websiteDir, 'passenger/index.html')));
app.get('/guardian',  (_req, res) => res.sendFile(path.join(websiteDir, 'guardian/index.html')));

// ─── 404 handler ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

// ─── Error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── WebSocket (Real-Time Engine) ────────────────────────────────────
initWebSocket(server);
startAssetJobs();

// ─── Start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚌 FleetSync API running on http://localhost:${PORT}`);
  console.log(`⚡  WebSocket ready on ws://localhost:${PORT}/ws`);
  console.log(`🌱 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server };
