'use strict';

/**
 * Global Express error handler.
 * Catches any error passed via next(err) and returns a consistent JSON envelope.
 */
function errorHandler(err, _req, res, _next) {
  console.error('[ErrorHandler]', err);

  let status  = err.status || err.statusCode || 500;
  let code    = err.code   || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred.';

  // Prisma constraint violations → 409 instead of a generic 500
  if (err.code === 'P2003') { status = 409; code = 'HAS_DEPENDENTS'; message = 'This record is still referenced by other records.'; }
  if (err.code === 'P2002') { status = 409; code = 'DUPLICATE'; message = 'A record with these values already exists.'; }
  // A malformed id (P2023) or a row that vanished (P2025) is simply "not found"
  if (err.code === 'P2023' || err.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = 'Not found.'; }

  // Anything unexpected keeps its details in the server log, never in the response.
  const expose = err.expose || status < 500 || err.code === 'P2003' || err.code === 'P2002' || err.code === 'P2023' || err.code === 'P2025';
  if (!expose) { code = 'INTERNAL_ERROR'; message = 'An unexpected error occurred.'; }

  res.status(status).json({
    success: false,
    error: { code, message },
  });
}

module.exports = { errorHandler };
