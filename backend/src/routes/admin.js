'use strict';

/**
 * Administration (Authority only): users, roles (for assigning to users), subscription,
 * institution, and the driver records (list/create/update/delete).
 *
 * GET/POST        /api/v1/fleet/users          PUT /users/:id       PUT /users/:id/roles
 * GET             /api/v1/fleet/roles
 * GET             /api/v1/fleet/subscription
 * GET/PUT         /api/v1/fleet/institution
 * GET/POST        /api/v1/fleet/drivers        PUT/DELETE /drivers/:id
 */

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, assertEnum, isUuid, wrap, checkPassword } = require('../lib/http');
const { TRACKING_TYPES, rolesFor, forgetTrackingType } = require('../lib/trackingType');

const AUTH = authenticate('AUTHORITY');
const EMPLOYMENT = ['active', 'on_leave', 'suspended', 'terminated'];

function dateOrNull(value, field) {
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(422, `INVALID_${field.toUpperCase()}`, `${field} must be a valid date.`);
  return d;
}

/** Every id must be a role of this tenant, else 422 INVALID_ROLE. Returns the role rows. */
async function tenantRoles(ids, institutionId) {
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) throw bad(422, 'INVALID_ROLE', 'Choose at least one valid role.');
  const unique = [...new Set(ids)];
  const rows = await prisma.role.findMany({ where: { id: { in: unique }, institutionId } });
  if (rows.length !== unique.length) throw bad(422, 'INVALID_ROLE', 'Role not found in your institution.');
  return rows;
}

// ── Users ────────────────────────────────────────────────────────────
const userInclude = { userRoles: { include: { role: true } }, driver: { select: { id: true } } };
const presentUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt,
  roles: u.userRoles.map((ur) => ur.role.name), roleIds: u.userRoles.map((ur) => ur.roleId), driverId: u.driver?.id ?? null,
});

async function ownUser(id, institutionId) {
  const u = isUuid(id) ? await prisma.user.findFirst({ where: { id, institutionId }, include: userInclude }) : null;
  if (!u) throw bad(404, 'USER_NOT_FOUND', 'User not found.');
  return u;
}

router.get('/users', AUTH, wrap(async (req, res) => {
  const rows = await prisma.user.findMany({ where: { institutionId: req.user.institutionId }, include: userInclude, orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows.map(presentUser) });
}));

router.post('/users', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name, email, phone, password, roleId } = req.body;
  if (!name || !email) throw bad(422, 'MISSING_FIELDS', 'name, email, password and roleId are required.');
  checkPassword(password);
  await tenantRoles([roleId], institutionId);
  if (await prisma.user.findUnique({ where: { email } })) throw bad(409, 'EMAIL_EXISTS', 'A user with this email already exists.');
  const u = await prisma.user.create({
    data: { institutionId, name, email, phone: phone || null, passwordHash: bcrypt.hashSync(password, 10), userRoles: { create: [{ roleId, institutionId }] } },
    include: userInclude,
  });
  res.status(201).json({ success: true, data: presentUser(u) });
}));

router.put('/users/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownUser(req.params.id, institutionId);
  const data = {};
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.');
    data.name = String(req.body.name).trim();
  }
  if (req.body.phone !== undefined) data.phone = req.body.phone || null;
  const u = await prisma.user.update({ where: { id: req.params.id }, data, include: userInclude });
  res.json({ success: true, data: presentUser(u) });
}));

router.put('/users/:id/roles', AUTH, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  await ownUser(req.params.id, institutionId);
  const roles = await tenantRoles(req.body.roleIds, institutionId);
  if (req.params.id === sub && !roles.some((r) => r.name === 'AUTHORITY')) {
    throw bad(422, 'CANNOT_DEMOTE_SELF', 'You cannot remove your own AUTHORITY role.');
  }
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: req.params.id } }),
    prisma.userRole.createMany({ data: roles.map((r) => ({ userId: req.params.id, roleId: r.id, institutionId })) }),
  ]);
  res.json({ success: true, data: presentUser(await ownUser(req.params.id, institutionId)) });
}));

// ── Roles (a user's role decides access; there is no permission matrix) ──────────────────────────────────────────────
router.get('/roles', AUTH, wrap(async (req, res) => {
  const rows = await prisma.role.findMany({
    where: { institutionId: req.user.institutionId },
    include: { _count: { select: { userRoles: true } } }, orderBy: { name: 'asc' },
  });
  res.json({
    success: true,
    data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.userRoles })),
  });
}));


// ── Subscription & institution ───────────────────────────────────────
router.get('/subscription', AUTH, wrap(async (req, res) => {
  const rows = await prisma.subscription.findMany({ where: { institutionId: req.user.institutionId }, orderBy: { startDate: 'desc' } });
  const present = (s) => ({
    id: s.id, planName: s.planName, status: s.status, startDate: s.startDate, endDate: s.endDate,
    daysRemaining: s.endDate ? Math.ceil((s.endDate.getTime() - Date.now()) / 86400000) : null,
  });
  res.json({ success: true, data: { current: rows[0] ? present(rows[0]) : null, history: rows.map(present) } });
}));

const presentInstitution = (i) => ({
  id: i.id, name: i.name, slug: i.slug, logoUrl: i.logoUrl,
  contactPhone: i.contactPhone, contactEmail: i.contactEmail, contactAddress: i.contactAddress,
  trackingType: i.trackingType, gpsRetentionDays: i.gpsRetentionDays,
});

/** undefined = not sent; '' / null clears; otherwise a trimmed string no longer than `max`. */
function optionalText(value, field, max) {
  if (value === undefined) return undefined;
  const s = value === null ? '' : String(value).trim();
  if (s.length > max) throw bad(422, 'INVALID_CONTACT', `${field} must be at most ${max} characters.`);
  return s || null;
}

router.get('/institution', AUTH, wrap(async (req, res) => {
  const i = await prisma.institution.findUnique({ where: { id: req.user.institutionId } });
  res.json({ success: true, data: presentInstitution(i) });
}));

router.put('/institution', AUTH, wrap(async (req, res) => {
  const data = {};
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.');
    data.name = String(req.body.name).trim();
  }
  if (req.body.logoUrl !== undefined) {
    const url = req.body.logoUrl ? String(req.body.logoUrl).trim() : null;
    if (url && (url.length > 500 || !/^https?:\/\/[^\s]+$/i.test(url))) throw bad(422, 'INVALID_LOGOURL', 'logoUrl must be an http(s) address, up to 500 characters.');
    data.logoUrl = url;   // slug is intentionally not editable
  }
  for (const [key, max] of [['contactPhone', 30], ['contactEmail', 120], ['contactAddress', 300]]) {
    const v = optionalText(req.body[key], key, max);
    if (v !== undefined) data[key] = v;
  }
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) throw bad(422, 'INVALID_CONTACT', 'contactEmail must be a valid email address.');
  const { institutionId } = req.user;
  if (req.body.gpsRetentionDays !== undefined) {
    const days = Number(req.body.gpsRetentionDays);
    if (![1, 7, 30, 90].includes(days)) throw bad(422, 'INVALID_GPSRETENTIONDAYS', 'gpsRetentionDays must be 1, 7, 30 or 90.');
    data.gpsRetentionDays = days;
  }
  if (req.body.trackingType !== undefined) {
    assertEnum(req.body.trackingType, TRACKING_TYPES, 'trackingType');
    data.trackingType = req.body.trackingType;
  }
  const i = await prisma.institution.update({ where: { id: institutionId }, data });
  if (data.trackingType) {
    // Switching keeps all data; the roles the new type needs are added, and the screens follow the type.
    for (const name of rolesFor(data.trackingType)) {
      await prisma.role.upsert({ where: { uq_roles_name: { institutionId, name } }, update: {}, create: { institutionId, name, isSystem: true } });
    }
    forgetTrackingType(institutionId);
  }
  res.json({ success: true, data: presentInstitution(i) });
}));

// ── Drivers ──────────────────────────────────────────────────────────
const driverInclude = { user: { select: { id: true, email: true } }, vehicles: { select: { id: true, vehicleNumber: true } } };
const presentDriver = (d) => ({
  id: d.id, name: d.name, phone: d.phone, email: d.user?.email || null, userId: d.userId,
  currentVehicleId: d.vehicles?.[0]?.id ?? null, currentVehicleNumber: d.vehicles?.[0]?.vehicleNumber ?? null,
  employeeCode: d.employeeCode, licenseNumber: d.licenseNumber, licenseClass: d.licenseClass,
  licenseExpiry: d.licenseExpiry, employmentStatus: d.employmentStatus, hiredAt: d.hiredAt,
});

async function ownDriver(id, institutionId) {
  const d = isUuid(id) ? await prisma.driver.findFirst({ where: { id, institutionId }, include: driverInclude }) : null;
  if (!d) throw bad(404, 'DRIVER_NOT_FOUND', 'Driver not found.');
  return d;
}

router.get('/drivers', AUTH, wrap(async (req, res) => {
  const rows = await prisma.driver.findMany({ where: { institutionId: req.user.institutionId }, include: driverInclude, orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows.map(presentDriver) });
}));

router.post('/drivers', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name, email, phone, password, licenseNumber, licenseClass, licenseExpiry, employeeCode, hiredAt } = req.body;
  if (!name || !email || !phone || !licenseNumber) throw bad(422, 'MISSING_FIELDS', 'name, email, phone, password and licenseNumber are required.');
  checkPassword(password);
  const role = await prisma.role.findFirst({ where: { institutionId, name: 'DRIVER' } });
  if (!role) throw bad(500, 'ROLE_MISSING', 'Driver role not found for this institution.');
  if (await prisma.user.findUnique({ where: { email } })) throw bad(409, 'EMAIL_EXISTS', 'A user with this email already exists.');
  if (await prisma.user.findFirst({ where: { institutionId, phone } })) throw bad(409, 'PHONE_EXISTS', 'Phone number already exists in this institution.');
  if (await prisma.driver.findUnique({ where: { uq_drivers_license: { institutionId, licenseNumber } } })) throw bad(409, 'DUPLICATE_LICENSE', 'License number already in use.');

  const driver = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { institutionId, name, email, phone, passwordHash: bcrypt.hashSync(password, 10), userRoles: { create: [{ roleId: role.id, institutionId }] } },
    });
    return tx.driver.create({
      data: {
        institutionId, userId: u.id, name, phone, licenseNumber, licenseClass: licenseClass || null, employeeCode: employeeCode || null,
        licenseExpiry: licenseExpiry ? dateOrNull(licenseExpiry, 'licenseExpiry') : null, hiredAt: hiredAt ? dateOrNull(hiredAt, 'hiredAt') : null,
      },
      include: driverInclude,
    });
  });
  res.status(201).json({ success: true, data: presentDriver(driver) });
}));

router.put('/drivers/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const existing = await ownDriver(req.params.id, institutionId);
  const b = req.body;
  const data = {};
  if (b.employmentStatus !== undefined) { assertEnum(b.employmentStatus, EMPLOYMENT, 'employmentStatus'); data.employmentStatus = b.employmentStatus; }
  for (const f of ['name', 'licenseNumber']) {
    if (b[f] === undefined) continue;
    if (!String(b[f]).trim()) throw bad(422, 'MISSING_FIELDS', `${f} cannot be empty.`);
    data[f] = String(b[f]).trim();
  }
  for (const f of ['phone', 'licenseClass', 'employeeCode']) if (b[f] !== undefined) data[f] = b[f] || null;
  if (b.licenseExpiry !== undefined) data.licenseExpiry = dateOrNull(b.licenseExpiry, 'licenseExpiry');
  if (b.hiredAt !== undefined) data.hiredAt = dateOrNull(b.hiredAt, 'hiredAt');
  if (data.licenseNumber && data.licenseNumber !== existing.licenseNumber) {
    const clash = await prisma.driver.findUnique({ where: { uq_drivers_license: { institutionId, licenseNumber: data.licenseNumber } } });
    if (clash) throw bad(409, 'DUPLICATE_LICENSE', 'License number already in use.');
  }
  const d = await prisma.$transaction(async (tx) => {
    // Keep the login identity's display name / phone in sync with the driver record.
    if (existing.userId && (data.name !== undefined || data.phone !== undefined)) {
      await tx.user.update({ where: { id: existing.userId }, data: { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.phone !== undefined ? { phone: data.phone } : {}) } });
    }
    return tx.driver.update({ where: { id: existing.id }, data, include: driverInclude });
  });
  res.json({ success: true, data: presentDriver(d) });
}));

router.delete('/drivers/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const d = await ownDriver(req.params.id, institutionId);
  const trips = await prisma.trip.count({ where: { institutionId, driverId: d.id } });
  if (trips) throw bad(409, 'DRIVER_HAS_TRIPS', `This driver has ${trips} trip(s) on record. Set their status to terminated instead.`);
  await prisma.$transaction([
    prisma.vehicle.updateMany({ where: { institutionId, assignedDriverId: d.id }, data: { assignedDriverId: null } }),
    prisma.driver.delete({ where: { id: d.id } }),
  ]);
  res.json({ success: true, data: { message: 'Driver deleted. Their login account was kept.' } });
}));

module.exports = router;
