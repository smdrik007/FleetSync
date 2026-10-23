'use strict';

/**
 * Guardians (Authority only): who may follow whom.
 * GET            /api/v1/fleet/guardians
 * POST           /api/v1/fleet/guardians              { name, email, phone, password, links: [{ assetId, relationship }] }
 * PUT            /api/v1/fleet/guardians/:id          { name, phone }
 * PUT            /api/v1/fleet/guardians/:id/people   { links: [{ assetId, relationship }] }   replaces the whole list
 * DELETE         /api/v1/fleet/guardians/:id          removes the account and every link
 */

const bcrypt = require('bcryptjs');
const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, isUuid, wrap, checkPassword } = require('../lib/http');
const { syncGuardianRooms } = require('../ws/server');

const AUTH = authenticate('AUTHORITY');
const isGuardian = { userRoles: { some: { role: { name: 'GUARDIAN' } } } };
const include = { guardianships: { include: { asset: { select: { id: true, name: true, kind: true } } }, orderBy: { createdAt: 'asc' } } };

const present = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt,
  people: u.guardianships.map((g) => ({ id: g.asset.id, name: g.asset.name, kind: g.asset.kind, relationship: g.relationship })),
});

async function ownGuardian(id, institutionId) {
  const u = isUuid(id) ? await prisma.user.findFirst({ where: { id, institutionId, ...isGuardian }, include }) : null;
  if (!u) throw bad(404, 'GUARDIAN_NOT_FOUND', 'Guardian not found.');
  return u;
}

/** [{ assetId, relationship }] → validated rows, every asset in this tenant, no duplicates. */
async function parseLinks(links, institutionId) {
  if (!Array.isArray(links)) throw bad(422, 'INVALID_LINKS', 'links must be a list of { assetId, relationship }.');
  const ids = links.map((l) => l?.assetId);
  if (!ids.every(isUuid) || new Set(ids).size !== ids.length) throw bad(422, 'INVALID_LINKS', 'Each person may appear once, by id.');
  const found = await prisma.asset.count({ where: { id: { in: ids }, institutionId } });
  if (found !== ids.length) throw bad(422, 'INVALID_ASSET', 'Person not found in your institution.');
  return links.map((l) => ({ assetId: l.assetId, relationship: l.relationship ? String(l.relationship).trim().slice(0, 60) || null : null }));
}

async function guardianRole(institutionId) {
  return prisma.role.upsert({
    where: { uq_roles_name: { institutionId, name: 'GUARDIAN' } }, update: {},
    create: { institutionId, name: 'GUARDIAN', description: 'Follows the people linked to them', isSystem: true },
  });
}

router.get('/guardians', AUTH, wrap(async (req, res) => {
  const rows = await prisma.user.findMany({ where: { institutionId: req.user.institutionId, ...isGuardian }, include, orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows.map(present) });
}));

router.post('/guardians', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { name, email, phone, password } = req.body;
  if (!name || !String(name).trim() || !email) throw bad(422, 'MISSING_FIELDS', 'name, email and password are required.');
  checkPassword(password);
  const links = await parseLinks(req.body.links || [], institutionId);
  if (await prisma.user.findUnique({ where: { email } })) throw bad(409, 'EMAIL_EXISTS', 'A user with this email already exists.');
  const role = await guardianRole(institutionId);
  const u = await prisma.user.create({
    data: {
      institutionId, name: String(name).trim(), email, phone: phone || null, passwordHash: bcrypt.hashSync(password, 10),
      userRoles: { create: [{ roleId: role.id, institutionId }] },
      guardianships: { create: links.map((l) => ({ assetId: l.assetId, relationship: l.relationship })) },
    },
    include,
  });
  res.status(201).json({ success: true, data: present(u) });
}));

router.put('/guardians/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const u = await ownGuardian(req.params.id, institutionId);
  const data = {};
  if (req.body.name !== undefined) { if (!String(req.body.name).trim()) throw bad(422, 'MISSING_FIELDS', 'name cannot be empty.'); data.name = String(req.body.name).trim(); }
  if (req.body.phone !== undefined) data.phone = req.body.phone || null;
  const updated = await prisma.user.update({ where: { id: u.id }, data, include });
  res.json({ success: true, data: present(updated) });
}));

router.put('/guardians/:id/people', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const u = await ownGuardian(req.params.id, institutionId);
  const links = await parseLinks(req.body.links, institutionId);
  await prisma.$transaction([
    prisma.guardianship.deleteMany({ where: { userId: u.id, institutionId } }),
    prisma.guardianship.createMany({ data: links.map((l) => ({ institutionId, userId: u.id, assetId: l.assetId, relationship: l.relationship })) }),
  ]);
  await syncGuardianRooms(u.id, institutionId);   // an open guardian page loses a removed person immediately
  res.json({ success: true, data: present(await ownGuardian(u.id, institutionId)) });
}));

router.delete('/guardians/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const u = await ownGuardian(req.params.id, institutionId);
  // Only a pure guardian account is deleted here; someone who is also staff keeps their login.
  const roles = await prisma.userRole.findMany({ where: { userId: u.id }, include: { role: true } });
  if (roles.some((r) => r.role.name !== 'GUARDIAN')) throw bad(409, 'HAS_OTHER_ROLES', 'This user has other roles. Remove the GUARDIAN role in Users instead.');
  await prisma.user.delete({ where: { id: u.id } });   // links, roles and notifications go with it
  await syncGuardianRooms(u.id, institutionId);
  res.json({ success: true, data: { message: 'Guardian removed.' } });
}));

module.exports = router;
