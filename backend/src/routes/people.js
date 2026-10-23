'use strict';

/**
 * People tracking (Authority only): tracked people/equipment, consent, guardians, safe zones.
 * GET/POST       /api/v1/fleet/people
 * PUT/DELETE     /api/v1/fleet/people/:id
 * PUT            /api/v1/fleet/people/:id/guardians          { userIds: [] }
 * POST           /api/v1/fleet/people/:id/geofences          { name, latitude, longitude, radiusM }
 * DELETE         /api/v1/fleet/people/:id/geofences/:zoneId
 * GET            /api/v1/fleet/people/:id/track              ?hours=24
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, assertEnum, isUuid, wrap } = require('../lib/http');
const { presentAssets, assetInclude, trail, createZone, deleteZone } = require('../lib/people');
const { syncGuardianRooms } = require('../ws/server');

const AUTH = authenticate('AUTHORITY');
const KINDS = ['person', 'equipment'];

async function ownAsset(id, institutionId) {
  const a = isUuid(id) ? await prisma.asset.findFirst({ where: { id, institutionId }, include: assetInclude }) : null;
  if (!a) throw bad(404, 'PERSON_NOT_FOUND', 'Person not found.');
  return a;
}
const one = async (id, institutionId) => (await presentAssets(institutionId, [await ownAsset(id, institutionId)], { withGuardians: true }))[0];

/** Optional ID number: trimmed, empty means none, and it must be free within the institution. */
async function cleanCode(v, institutionId, exceptId) {
  const code = v === undefined || v === null ? null : String(v).trim().slice(0, 40) || null;
  if (code) {
    const clash = await prisma.asset.findFirst({ where: { institutionId, code }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw bad(409, 'DUPLICATE_CODE', 'Another person already has this ID number.');
  }
  return code;
}

function retention(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw bad(422, 'INVALID_RETENTIONDAYS', 'retentionDays must be a whole number from 1 to 365.');
  return n;
}

/** Every tenant needs a GUARDIAN role before a user can be given it; make it on first use. */
async function ensureGuardianRole(institutionId) {
  await prisma.role.upsert({
    where: { uq_roles_name: { institutionId, name: 'GUARDIAN' } }, update: {},
    create: { institutionId, name: 'GUARDIAN', description: 'Follows the people linked to them', isSystem: true },
  });
}

router.get('/people', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ensureGuardianRole(institutionId);
  const assets = await prisma.asset.findMany({ where: { institutionId }, include: assetInclude, orderBy: { name: 'asc' } });
  res.json({ success: true, data: await presentAssets(institutionId, assets, { withGuardians: true }) });
}));

router.post('/people', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name, kind = 'person', notes, consent, consentBy, retentionDays } = req.body;
  const code = await cleanCode(req.body.code, institutionId);
  if (!name || !String(name).trim()) throw bad(422, 'MISSING_FIELDS', 'name is required.');
  assertEnum(kind, KINDS, 'kind');
  const a = await prisma.asset.create({
    data: {
      institutionId, name: String(name).trim(), kind, code, notes: notes || null,
      consentAt: consent ? new Date() : null, consentBy: consent ? (consentBy || null) : null,
      ...(retentionDays !== undefined && retentionDays !== null ? { retentionDays: retention(retentionDays) } : {}),
    },
  });
  res.status(201).json({ success: true, data: await one(a.id, institutionId) });
}));

router.put('/people/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const a = await ownAsset(req.params.id, institutionId);
  const b = req.body, data = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.'); data.name = String(b.name).trim(); }
  if (b.kind !== undefined) { assertEnum(b.kind, KINDS, 'kind'); data.kind = b.kind; }
  if (b.notes !== undefined) data.notes = b.notes || null;
  if (b.code !== undefined) data.code = await cleanCode(b.code, institutionId, a.id);
  if (b.trackingPaused !== undefined) data.trackingPaused = !!b.trackingPaused;
  if (b.retentionDays !== undefined) data.retentionDays = retention(b.retentionDays);
  if (b.consent === true) { data.consentAt = a.consentAt || new Date(); data.consentBy = b.consentBy || a.consentBy || null; }
  if (b.consent === false) { data.consentAt = null; data.consentBy = null; }
  await prisma.asset.update({ where: { id: a.id }, data });
  res.json({ success: true, data: await one(a.id, institutionId) });
}));

router.delete('/people/:id', AUTH, wrap(async (req, res) => {
  const a = await ownAsset(req.params.id, req.user.institutionId);
  if (a.devices.length) throw bad(409, 'HAS_DEPENDENTS', 'Remove or move this person\'s device first.');
  await prisma.asset.delete({ where: { id: a.id } });   // points, zones and guardian links go with it
  res.json({ success: true, data: { message: 'Person removed.' } });
}));

router.put('/people/:id/guardians', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const a = await ownAsset(req.params.id, institutionId);
  const ids = req.body.userIds;
  if (!Array.isArray(ids) || !ids.every(isUuid)) throw bad(422, 'INVALID_USER', 'userIds must be a list of user ids.');
  const users = await prisma.user.findMany({ where: { id: { in: ids }, institutionId, userRoles: { some: { role: { name: 'GUARDIAN' } } } }, select: { id: true } });
  if (users.length !== new Set(ids).size) throw bad(422, 'INVALID_GUARDIAN', 'Every guardian must be a user of your institution with the GUARDIAN role.');
  // Keep existing links (and their relationship), drop the unticked, add the new.
  const before = a.guardianships.map((g) => g.userId);
  await prisma.$transaction([
    prisma.guardianship.deleteMany({ where: { assetId: a.id, institutionId, userId: { notIn: users.map((u) => u.id) } } }),
    prisma.guardianship.createMany({ data: users.map((u) => ({ institutionId, userId: u.id, assetId: a.id })), skipDuplicates: true }),
  ]);
  await Promise.all([...new Set([...before, ...users.map((u) => u.id)])].map((uid) => syncGuardianRooms(uid, institutionId)));
  res.json({ success: true, data: await one(a.id, institutionId) });
}));

router.post('/people/:id/geofences', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const a = await ownAsset(req.params.id, institutionId);
  await createZone(institutionId, a.id, req.body);
  res.status(201).json({ success: true, data: await one(a.id, institutionId) });
}));

router.delete('/people/:id/geofences/:zoneId', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const a = await ownAsset(req.params.id, institutionId);
  await deleteZone(institutionId, a.id, req.params.zoneId);
  res.json({ success: true, data: await one(a.id, institutionId) });
}));

router.get('/people/:id/track', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const a = await ownAsset(req.params.id, institutionId);
  const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
  res.json({ success: true, data: await trail(institutionId, a.id, hours) });
}));

module.exports = router;
