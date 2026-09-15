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
        error: { code: 'MISSING_FIELDS', message: 'institutionId, email, and password are required.' },
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
    const user = await prisma.user.findUnique({
      where: { institutionId_email: { institutionId, email } },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

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
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true, email: true, role: true, institutionId: true, phone: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

module.exports = router;
