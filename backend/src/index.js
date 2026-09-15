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
const { errorHandler }  = require('./middleware/error');

const app    = express();
const server = http.createServer(app);

// ─── Global Middleware ───────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'FleetSync API', version: '1.0.0' }));

// ─── API Routes ──────────────────────────────────────────────────────
app.use('/api/v1',          authRouter);
app.use('/api/v1/fleet',    fleetRouter);
app.use('/api/v1/driver',   driverRouter);
app.use('/api/v1/passenger', passengerRouter);

// ─── Static Frontend ─────────────────────────────────────────────────
const path = require('path');
const websiteDir = path.join(__dirname, '../../website');
app.use(express.static(websiteDir));

app.get('/authority', (_req, res) => res.sendFile(path.join(websiteDir, 'authority/index.html')));
app.get('/driver',    (_req, res) => res.sendFile(path.join(websiteDir, 'driver/index.html')));
app.get('/passenger', (_req, res) => res.sendFile(path.join(websiteDir, 'passenger/index.html')));

// ─── 404 handler ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

// ─── Error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── WebSocket (Real-Time Engine) ────────────────────────────────────
initWebSocket(server);

// ─── Start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚌 FleetSync API running on http://localhost:${PORT}`);
  console.log(`⚡  WebSocket ready on ws://localhost:${PORT}/ws`);
  console.log(`🌱 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server };
