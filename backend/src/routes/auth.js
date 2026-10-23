'use strict';

/**
 * Auth Routes
 * GET  /api/v1/institutions
 * POST /api/v1/auth/signup   (public: creates an institution, its first AUTHORITY user and a trial)
 * POST /api/v1/auth/login
 * POST /api/v1/auth/logout
 * GET  /api/v1/auth/me
 * GET  /api/v1/contact        (any role: own institution's contact details)
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const prisma  = require('../db/client');
const { signToken, authenticate } = require('../middleware/auth');
const { bad, checkPassword } = require('../lib/http');
const { TRACKING_TYPES, rolesFor } = require('../lib/trackingType');

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

// ── POST /auth/signup ─────────────────────────────────────────────────
// Public self-service onboarding. shortcut: no email verification yet, so anyone can create a trial tenant; add it before charging money.
// Every attempt counts, valid or not, so the email-exists answer cannot be used to probe accounts. Production defaults to 5 per hour per IP.
const SIGNUPS_PER_HOUR = Number(process.env.SIGNUPS_PER_HOUR) || (process.env.NODE_ENV === 'production' ? 5 : 100);
const signups = new Map();   // ip -> { n, until }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function throttleSignup(ip) {
  const now = Date.now();
  if (signups.size > 5000) signups.clear();
  const s = signups.get(ip);
  if (!s || now > s.until) { signups.set(ip, { n: 1, until: now + 3600_000 }); return; }
  if (++s.n > SIGNUPS_PER_HOUR) throw bad(429, 'TOO_MANY_SIGNUPS', 'Too many sign-ups from this address. Try again later.');
}

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';

router.post('/auth/signup', async (req, res, next) => {
  try {
    throttleSignup(req.ip);
    const institutionName = String(req.body.institutionName || '').trim();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const { trackingType, password } = req.body;
    if (institutionName.length < 2 || institutionName.length > 80) throw bad(422, 'INVALID_INSTITUTIONNAME', 'Organisation name must be 2 to 80 characters.');
    if (name.length < 2 || name.length > 80) throw bad(422, 'INVALID_NAME', 'Your name must be 2 to 80 characters.');
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad(422, 'INVALID_EMAIL', 'Enter a valid email address.');
    if (!TRACKING_TYPES.includes(trackingType)) throw bad(422, 'INVALID_TRACKINGTYPE', `Choose what you want to track: ${TRACKING_TYPES.join(', ')}.`);
    checkPassword(password);
    if (await prisma.user.findUnique({ where: { email } })) throw bad(409, 'EMAIL_EXISTS', 'An account with this email already exists.');

    // The slug is public and unique; add a short suffix when the name is taken.
    const base = slugify(institutionName);
    let slug = base;
    for (let i = 2; await prisma.institution.findUnique({ where: { slug } }); i += 1) slug = `${base}-${i}`;

    const trialEnds = new Date(Date.now() + 14 * 86400_000);
    const { institution, user } = await prisma.$transaction(async (tx) => {
      const inst = await tx.institution.create({ data: { name: institutionName, slug, trackingType } });
      const roles = {};
      for (const r of rolesFor(trackingType)) roles[r] = await tx.role.create({ data: { institutionId: inst.id, name: r, isSystem: true } });
      const u = await tx.user.create({
        data: {
          institutionId: inst.id, name, email, phone: req.body.phone ? String(req.body.phone).trim().slice(0, 30) : null,
          passwordHash: bcrypt.hashSync(password, 10),
          userRoles: { create: [{ roleId: roles.AUTHORITY.id, institutionId: inst.id }] },
        },
      });
      await tx.subscription.create({ data: { institutionId: inst.id, planName: 'Trial', status: 'trial', endDate: trialEnds } });
      return { institution: inst, user: u };
    });

    const token = signToken({ sub: user.id, institutionId: institution.id, role: 'AUTHORITY' });
    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: 'AUTHORITY', institutionId: institution.id, phone: user.phone, trackingType },
        institution: { id: institution.id, name: institution.name, slug: institution.slug, trackingType },
        redirectTo: '/authority',
      },
    });
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
    const redirectMap = { AUTHORITY: '/authority', DRIVER: '/driver', PASSENGER: '/passenger', GUARDIAN: '/guardian' };

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, institutionId: user.institutionId, phone: user.phone, trackingType: institution.trackingType },
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
    user.trackingType = (await prisma.institution.findUnique({ where: { id: user.institutionId }, select: { trackingType: true } }))?.trackingType || 'vehicle';

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ── GET /contact ──────────────────────────────────────────────────────
// Any signed-in role reads its own institution's contact details (mobile "Contact us").
router.get('/contact', authenticate(), async (req, res, next) => {
  try {
    const i = await prisma.institution.findUnique({
      where: { id: req.user.institutionId },
      select: { name: true, contactPhone: true, contactEmail: true, contactAddress: true },
    });
    res.json({ success: true, data: i });
  } catch (err) { next(err); }
});

module.exports = router;
