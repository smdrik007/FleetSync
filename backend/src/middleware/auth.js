'use strict';

const jwt = require('jsonwebtoken');

const SECRET     = process.env.JWT_SECRET || 'fleetsync_dev_secret';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Sign a JWT for a user.
 * @param {object} payload  - { sub, institutionId, role }
 */
function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

/**
 * Verify and decode a JWT.
 * Throws JsonWebTokenError / TokenExpiredError on failure.
 */
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

/**
 * Express middleware — verifies the Bearer token and attaches
 * decoded payload to req.user  (sub, institutionId, role).
 *
 * Optionally restrict to specific roles:
 *   authenticate('AUTHORITY')
 *   authenticate('DRIVER', 'AUTHORITY')
 */
function authenticate(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Authorization token required.' },
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired.' },
      });
    }

    if (allowedRoles.length && !allowedRoles.includes(decoded.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' },
      });
    }

    req.user = decoded; // { sub, institutionId, role }
    next();
  };
}

module.exports = { signToken, verifyToken, authenticate };
