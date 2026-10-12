'use strict';

/**
 * Auth Routes
 * GET  /api/v1/institutions
 * POST /api/v1/auth/login
 * POST /api/v1/auth/logout
 * GET  /api/v1/auth/me
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const prisma  = require('../db/client');
const { signToken, authenticate } = require('../middleware/auth');

// Brute-force guard: 10 failed logins per client IP + account per 15 minutes.
// shortcut: in-memory, resets on restart and is per process; move to Redis if the API ever runs on several instances.
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const fails = new Map(); // key -> { n, until }
const failKey = (req, account) => `${req.ip}|${String(account).toLowerCase()}`;
function isThrottled(key) {
  const f = fails.get(key);
  if (f && Date.now() > f.until) fails.delete(key);
  return !!fails.get(key) && fails.get(key).n >= MAX_FAILS;
}
function noteFail(key) {
  if (fails.size > 5000) fails.clear(); // keep the map bounded under a flood of distinct keys
  const f = fails.get(key);
  if (!f || Date.now() > f.until) fails.set(key, { n: 1, until: Date.now() + FAIL_WINDOW_MS });
  else f.n += 1;
}

// ── GET /institutions ─────────────────────────────────────────────────
router.get('/institutions', async (req, res, next) => {
  try {
    const { q, limit = 50 } = req.query;

    const institutions = await prisma.institution.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      take:  parseInt(limit, 10),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, logoUrl: true },
    });

    res.json({ success: true, data: institutions });
  } catch (err) { next(err); }
});

// ── POST /auth/login ──────────────────────────────────────────────────
router.post('/auth/login', async (req, res, next) => {
  try {
    const { institutionId, email, password } = req.body;

    if (!institutionId || !email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'institutionId, email/phone, and password are required.' },
      });
    }

    const key = failKey(req, email);
    if (isThrottled(key)) {
      return res.status(429).json({
        success: false,
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts. Try again in a few minutes.' },
      });
    }

    // Verify institution exists
    const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) {
      return res.status(404).json({
        success: false,
        error: { code: 'INSTITUTION_NOT_FOUND', message: 'Institution not found.' },
      });
    }

    // Find user by email within institution
    // Note: email is globally unique in v2.0 schema, institution is verified separately
    const isEmail = email.includes('@');
    let user;
    if (isEmail) {
      user = await prisma.user.findUnique({
        where: { email },
        include: { userRoles: { include: { role: true } } }
      });
      // Verify user belongs to the declared institution
      if (user && user.institutionId !== institutionId) {
        noteFail(key);
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        });
      }
    } else {
      // Phone is not globally unique — search within institution
      user = await prisma.user.findFirst({
        where: { phone: email, institutionId },
        include: { userRoles: { include: { role: true } } }
      });
    }
    
    if (user) {
      user.role = user.userRoles[0]?.role?.name || 'PASSENGER';
    }

    if (!user) {
      noteFail(key);
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      noteFail(key);
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    fails.delete(key);

    // Sign JWT
    const token = signToken({ sub: user.id, institutionId: user.institutionId, role: user.role });

    // Determine redirect path by role (FR-AUTH-03)
    const redirectMap = { AUTHORITY: '/authority', DRIVER: '/driver', PASSENGER: '/passenger' };

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, institutionId: user.institutionId, phone: user.phone },
        redirectTo: redirectMap[user.role],
      },
    });
  } catch (err) { next(err); }
});

// ── POST /auth/logout ─────────────────────────────────────────────────
// Stateless JWT — logout is handled client-side (delete token from storage)
router.post('/auth/logout', authenticate(), (_req, res) => {
  res.json({ success: true, data: { message: 'Logged out successfully.' } });
});

// ── GET /auth/me ──────────────────────────────────────────────────────
router.get('/auth/me', authenticate(), async (req, res, next) => {
  try {
    let user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true, email: true, institutionId: true, phone: true, createdAt: true, userRoles: { include: { role: true } } },
    });

    if (user) {
      user.role = user.userRoles[0]?.role?.name || 'PASSENGER';
      delete user.userRoles;
    }

    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

module.exports = router;
