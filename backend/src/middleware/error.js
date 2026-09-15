'use strict';

/**
 * Global Express error handler.
 * Catches any error passed via next(err) and returns a consistent JSON envelope.
 */
function errorHandler(err, _req, res, _next) {
  console.error('[ErrorHandler]', err);

  const status  = err.status || err.statusCode || 500;
  const code    = err.code   || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred.';

  res.status(status).json({
    success: false,
    error: { code, message },
  });
}

module.exports = { errorHandler };
