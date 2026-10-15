'use strict';

// Vercel serverless entry: the Express app without a listener (see backend/src/index.js).
module.exports = require('../backend/src/index.js').app;
